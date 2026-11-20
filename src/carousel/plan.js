// launchclip carousel make, the plan: one model call turns a brief into a
// carousel story (docs/CAROUSELS_RFC.md §4, §5, §7), tooling checks it, and
// one repair call gets the errors when it fails. The model client is make's
// (src/make/models.js), so tests pass a fake with runStructured().
import { CAROUSEL_ARCS, CAROUSEL_ARC_IDS, CAROUSEL_BACKGROUND_MODES, CAROUSEL_DESTINATIONS, CAROUSEL_GOALS, MOTION_SLIDE_SECONDS, SLIDE_SECONDS, destinationProblems } from "@launchclip/core/carousel.mjs";
import { STORY_SCHEMA, resolveStory, validateStory } from "@launchclip/core/story.mjs";
import { validateModuleParams } from "@launchclip/core/module-schemas.mjs";
import { resolveModule, sceneRenderEnd } from "@launchclip/core/modules.mjs";
import { dropParam } from "../storyboard_planner.js";
import { moduleCatalogue } from "@launchclip/core/planning-prompt.mjs";
import { CAROUSEL_GRAMMARS, CAROUSEL_TEMPLATES, CTA_HEADLINE, drawSlide, layoutCarousel, pickTemplate, slideCaps, surfacePlate, templateCopyProblems } from "@launchclip/core/carousel-templates.mjs";
import { carouselPlanFindings } from "@launchclip/core/carousel-check.mjs";

// Modules that need what a carousel does not have (footage, a presenter, a
// cast, a logo file, audio, live data) or that only read in motion.
// shortcut: a hand list until modules carry a `still: false` capability (RFC §5.4); move it there then.
const NOT_FOR_SLIDES = new Set(["clip", "punch-in", "zoom-through", "footage-callout", "lower-third", "picture-in-picture", "evidence-clip", "product-demo", "emphasis-caption", "set-prop", "app-stage", "phone-stage", "brand-lockup", "logo-sting", "subscribe-cta", "channel-watermark", "audio-visualizer", "live-counter", "live-bars", "cast-scene", "character-cameo", "sprite-scene", "world", "particle-text", "particle-logo", "particle-cloud", "dot-field", "ticker-tape", "countdown", "slot-roll", "grid-race", "race-bars", "tokenizer"]);
// Modules whose picture is a photo: offered only when there are photos (--images or --generate).
export const PHOTO_MODULES = Object.freeze(["photo-scene", "media-stat", "media-list", "media-grid", "media-compare", "before-after", "polaroid", "landscape-card", "split-screen"]);
// The call to action each goal asks for (RFC §4 "one call to action at the end").
const GOAL_CTA = { save: "save the post", comment: "comment a keyword", follow: "follow the account", visit: "visit a link", install: "install the app" };
const DEFAULT_GOAL = { listicle: "save", "how-to": "save", data: "save", "myth-fact": "comment", "before-after": "follow", story: "follow", ad: "install", quote: "follow", single: "follow" };
// The words a cta slide says for each goal, as the check reads them (carousel-check.mjs CTA_WORDS).
const GOAL_WORDS = { save: "\"Save\"", comment: "\"Comment\" and the keyword", follow: "\"Follow\"", visit: "\"Visit\" or \"link in bio\"", install: "\"Download\", \"Install\" or \"Try it\"" };

// The arc a brief reads as, in order of how sure the cue is; listicle when none fits. It sets the template, so the
// template's rules are in the first prompt; the model may still pick another arc.
// shortcut: English cues; a brief in another language reads as a listicle until these are per-language.
const ARC_CUES = [
  ["single", /\b(?:one|single)[- ](?:image|slide|photo|graphic|picture)\b/i],
  ["myth-fact", /\bmyths?\b|\bmisconceptions?\b/i],
  ["before-after", /\bbefore (?:and|&|\/) after\b/i],
  ["ad", /\b(?:an? ad|advert|ad for)\b/i],
  ["quote", /\bquote\b|["“][^"”]{20,}["”]/i],
  ["data", /\b(?:survey(?:ed)?|report|study|research|data)\b.*\d|\d+(?:\.\d+)?%.*\d+(?:\.\d+)?%/i],
  ["how-to", /\bhow to\b|\bstep[- ]by[- ]step\b|\bin \w+ steps\b/i],
  ["story", /\b(?:my|our) (?:story|journey)\b|\bI (?:left|quit|started|built|moved)\b/i]
];
export function guessArc(brief) {
  return ARC_CUES.find(([, cue]) => cue.test(String(brief)))?.[0] ?? "listicle";
}

// What the planner is told a cap is: under the template's, so a plan that counts loosely still fits.
const told = (cap) => Math.floor(cap * 0.85);
// A cap as the model reads it best: characters, and the words that fill them (about six characters a word).
const chars = (cap) => `${told(cap)} characters (about ${Math.max(1, Math.floor(told(cap) / 6))} words)`;

export const CAROUSEL_PLAN_SCHEMA = Object.freeze({
  type: "object",
  properties: { carousel_json: { type: "string", description: "The carousel plan as one JSON object, serialised." } },
  required: ["carousel_json"],
  additionalProperties: false
});

/** Module ids a slide may use: catalogue modules (never the editorial panels) that make sense as a still. */
export function slideModules({ photos = false } = {}) {
  return moduleCatalogue().filter((m) => m.family === "catalogue" && !m.needs?.length && !m.layer && !NOT_FOR_SLIDES.has(m.id) && (photos || !PHOTO_MODULES.includes(m.id)));
}

/**
 * The slide count range for a plan: the arc's range (any arc's when the arc is
 * auto) inside every destination's limits; --slides picks one count in it.
 * → {min, max, exact: number|null}
 */
export function slideRange({ arc = null, destinations, slides = null }) {
  const arcs = arc ? [CAROUSEL_ARCS[arc]] : Object.values(CAROUSEL_ARCS);
  let min = Math.min(...arcs.map((entry) => entry.slides[0]));
  let max = Math.max(...arcs.map((entry) => entry.slides[1]));
  for (const id of destinations) {
    min = Math.max(min, CAROUSEL_DESTINATIONS[id].slides[0]);
    max = Math.min(max, CAROUSEL_DESTINATIONS[id].slides[1]);
  }
  if (min > max) throw new Error(`no slide count fits ${arc ? `a ${arc} carousel` : "any arc"} on ${destinations.join(" and ")}; drop a destination or pick another --arc`);
  const exact = slides == null ? null : Math.min(max, Math.max(min, slides));
  return { min, max, exact };
}

/** The planning instructions, in this repo's own words. */
// shortcut: the list budgets are measured at 4:5 (1080×1350) with the default brand; derive them from moduleFit per canvas if other aspects need different numbers.
export function planInstructions({ arc, guess = null, goal, destinations, range, modules, photos, generate, template = null, video = false, clips = [], extras = null }) {
  const dest = CAROUSEL_DESTINATIONS[destinations[0]];
  const exact = range.exact ?? (range.min === range.max ? range.min : null);
  const count = exact === 1 ? "exactly 1 slide: the cover is the whole post, with no cta slide; the caption carries the ask" : exact != null ? `exactly ${exact} slides` : `${range.min} to ${range.max} slides`;
  const arcs = arc ? `The arc is ${arc}: ${CAROUSEL_ARCS[arc].describe}.` : `The brief reads as a ${guess} carousel; keep that arc unless another clearly fits better:\n${CAROUSEL_ARC_IDS.map((id) => `- ${id} (${CAROUSEL_ARCS[id].slides.join("-")} slides): ${CAROUSEL_ARCS[id].describe}`).join("\n")}`;
  const caps = template ? CAROUSEL_TEMPLATES[template].caps : { headline: 48, body: 50 };
  const lines = [
    "You plan a carousel: a set of slides people swipe through in a social feed. Return one JSON object in carousel_json.",
    "",
    "Shape:",
    '{"title": string, "arc": string, "goal": string, "caption": {"hook": string, "body": string, "cta": string, "tags": [string]}' + (extras ? ', "background"?: {"mode": "shared"|"per-slide"|"none", "image"?: string}' + (extras.panorama !== false && !video ? ', "panorama"?: {"image": string, "slides": [from, to]}' : "") : "") + ', "slides": [{"id": kebab-case, "role": "cover"|"body"|"payoff"|"cta", "headline": string, "body"?: string, "items"?: [string], "stat"?: {"value", "label", "source"}, "quote"?: {"text", "author", "role"?}, "eyebrow"?: string, "emphasis"?: string, "handle"?: string' + (photos?.length ? ', "photo"?: one of the photos' : "") + ', "alt": string' + (generate ? ', "image": string|null' : "") + (extras ? ', "background"?: string' : "") + (video ? ', "seconds": number, "loop"?: boolean' + (clips.length ? ', "clip"?: one of the clips, "clip_start"?: number' : "") : "") + "}]}",
    `You write each slide's words; tooling lays them out with a carousel template. Set only the fields a slide needs: a list or a checklist as items (2 to 6); a figure as stat, with its source; a quote with the person who said it; a pair as a headline that opens on the first marker and a body that opens on the second ("Myth: …" / "Fact: …", "Before: …" / "After: …", "Don't: …" / "Do: …"), each side at most ${told(CAROUSEL_GRAMMARS["two-region"].caps.body)} characters after its marker; eyebrow is a small label (a step number or section), emphasis a word of the headline to colour, handle the account or link on the cta slide.`,
    "",
    arcs,
    `Make ${count}. The canvas is ${dest.width}×${dest.height} (${dest.aspect}) for ${destinations.join(", ")}.`,
    `The goal is ${goal}: the cta slide (the last) and caption.cta ask the reader to ${GOAL_CTA[goal]}, and nothing else. The cta headline says ${GOAL_WORDS[goal]} in so many words.`,
    "",
    "What makes a carousel work:",
    "- The cover is the only slide the feed shows. Its headline makes one specific promise in 4 to 10 words, inside the template's cap: a number and what it gets you, a named result, or a sharp question. Not the topic (\"Sleep myths\"), the promise (\"4 sleep myths that cost you rest\"). The cover has no body line, no stat and no list; tooling adds the swipe cue.",
    "- One idea per slide: a headline and at most one line or list under it, 25 words in all. If an idea needs two reads, split it. Each slide says something the others do not.",
    "- Roles: the first slide is the cover; one cta slide, last (a 1- or 2-slide post may end on its message instead). A list, steps, story, data or before-after carousel puts a payoff slide just before the cta: the checklist, the summary or the result, written so it is worth saving on its own.",
    "- Write like a person who knows the subject: concrete nouns, numbers from the brief, verbs. No stock phrases (\"game-changer\", \"unlock your potential\", \"the power of\"), no labels (\"Slide 2:\", \"Tip:\"), no ellipses, no line ending on \"and\" or \"the\".",
    "- alt: what the slide shows for a screen reader (its words and picture), never a file name.",
    "- The caption: hook is the post's first line, a second hook in 4 to 14 words that does not copy the cover (under " + dest.captionPreview + " characters). body is 2 to 4 sentences that add what the slides leave out: the why, an example, a caveat. cta matches the cta slide. tags: " + (destinations.some((id) => CAROUSEL_DESTINATIONS[id].tags) ? "3 to 5 topical tags without #." : "an empty list (these destinations do not use tags)."),
    `- Text that does not fit is refused, so count characters: a headline at most ${chars(caps.headline)}, a line under it at most ${chars(caps.body)}, list items at most ${chars(32)}, an eyebrow at most 20. When a check says text is too long, cut it well under the limit.`,
    "- Use only facts the brief gives or that are common knowledge; never invent statistics, customers or quotes.",
    ...(template ? ["", ...templateGuide(template, { photos: photos?.length > 0 || clips?.length > 0 || generate })] : []),
    "",
    ...(photos?.length ? [`The user's photos (set a slide's photo to one, as written): ${photos.join(", ")}. Use them: every slide whose layout takes a photo gets one that fits it, judged by the file name, and a story carousel has one on most slides. A photo of something else (a screenshot on a hiking slide) is worse than none.`] : []),
    ...(video ? videoInstructions(clips, generate) : []),
    ...(extras ? extrasInstructions(extras, { video, count: range.exact ?? range.max }) : []),
    ...(generate && !video ? ['Slides may have a generated photo: set "image" to what it shows in plain lower-case words (a scene, no brand, person name, text or logo). Every photo slide shares one setting, kind of people and time of day. Leave "image" null on other slides.'] : [])
  ];
  return lines.join("\n");
}

/** What each slide role takes in a template, in the planner's words: the template's layout, so the plan fits it first time. */
export function templateGuide(id, { photos = false } = {}) {
  const template = CAROUSEL_TEMPLATES[id];
  const { type } = template;
  const says = (role) => {
    const wanted = template.grammar[role];
    const grammar = CAROUSEL_GRAMMARS[wanted]?.needsImage && !photos ? "text-card" : wanted;
    const caps = slideCaps(template, grammar);
    const head = chars(type.note ? 90 : type.poster ? 48 : role === "cta" ? Math.min(caps.headline, CTA_HEADLINE) : caps.headline);
    const photo = CAROUSEL_GRAMMARS[grammar].needsImage ? "; give it a photo" : "";
    if (role === "cover") return `the promise as the headline alone, at most ${head}${type.note ? ", sentence case" : ""}${photo}`;
    if (role === "payoff" && grammar === "proof-stat") return "the brief's key figure as stat, else the summary as items";
    if (grammar === "step") return `one step: the headline is the step, at most ${head}, no body line; the slides number themselves`;
    if (grammar === "steps") return "the checklist as items (2 to 6), a headline over them";
    if (grammar === "image-panel") return `a photo over a panel: the headline (at most ${head}) and a line (at most ${chars(caps.body)}) or 2 to 4 short items${photo}`;
    if (grammar === "framed-image") return `a framed photo: the headline (at most ${head}) above it and a caption line (at most ${chars(caps.body)}) under it${photo}`;
    if (type.note) return `one observation in the account's own voice, as the headline alone (at most ${head}, sentence case); no body line, it is not drawn`;
    if (type.poster) return `heavy capitals: the headline (at most ${head}) and an optional line under it (at most ${chars(90)})`;
    if (role === "cta") return `the ask as the headline (at most ${head}), an optional line under it, the handle or link as handle`;
    return `the headline (at most ${head}) and an optional line under it (at most ${chars(caps.body)})`;
  };
  return [
    `The template is ${id}: ${template.describe}`,
    "What each slide takes in it (a myth/fact or before/after pair, a stat or a list on a body slide takes its own layout):",
    ...["cover", "body", "payoff", "cta"].map((role) => `- ${role}: ${says(role)}.`)
  ];
}

// A video carousel (RFC §5.3): each slide is its own short clip, footage or drawn.
function videoInstructions(clips, generate) {
  const [min, max] = MOTION_SLIDE_SECONDS;
  return [
    `This is a video carousel: every slide is its own short silent video, and the reader swipes to the next. Set each slide's "seconds" (${min} to ${max}) by what happens in it: about ${min} for a single beat (a hook line, a punchline), 3 to 5 for most slides (${SLIDE_SECONDS} when nothing calls for more), up to ${max} only when the motion needs the time. Set "loop": true only on a slide worth watching twice whose motion returns to its start; otherwise it plays once and holds its last frame.`,
    `A footage slide plays a video under its words; the others are drawn (type and graphics that animate). When there are clips, the cover and most body slides are footage: set their "clip", picking the clip whose name fits what the slide says. A footage slide's words are set over the clip, so keep them short: a headline at most ${told(CAROUSEL_GRAMMARS["full-bleed"].caps.headline)} characters and a line at most ${told(CAROUSEL_GRAMMARS["full-bleed"].caps.body)}, or the headline alone.`,
    ...(clips.length ? [`The user's clips, with their lengths (set a footage slide's "clip" to one, as written, and "clip_start" to the second it starts from, so clip_start + seconds stays inside the clip): ${clips.map((clip) => `${clip.src} (${clip.seconds} s)`).join(", ")}.`] : []),
    ...(generate ? ['A slide may have generated footage: set "image" to the opening frame in plain lower-case words (a scene, no brand, person name, text or logo); it is made as a still, checked, then animated into the slide\'s clip. Every generated slide shares one setting, kind of people and time of day. Leave "image" null on drawn slides.'] : [])
  ];
}

// What a generated background or panorama shows: atmosphere for the words to sit on, never a subject.
const BACKDROP_WORDS = "in plain lower-case words: a texture, an atmosphere or a soft scene in the brand's colours, with clean open space where the words sit; a background, not a subject: no people, text, logos, brands or names";

/**
 * A generated background and panorama (make --background / --panorama, with --generate). extras: {background:
 * mode|null, panorama: true|false|null}; null leaves the choice to the plan.
 */
function extrasInstructions({ background = null, panorama = null }, { video, count }) {
  const lines = [];
  const what = video ? "a short looping video" : "an image";
  if (background === "shared") lines.push(`Every slide sits on one generated background, ${what} under the words: set background {"mode": "shared", "image": what it shows, ${BACKDROP_WORDS}}.`);
  else if (background === "per-slide") lines.push(`Each slide sits on its own generated background, ${what} under the words: set background {"mode": "per-slide"} and each slide's "background" to what it shows, ${BACKDROP_WORDS}. They share one palette, setting and light, so the carousel reads as one.`);
  else if (background === null) lines.push(`A carousel may sit on generated backgrounds (${what} under the words of every slide that has no photo): background {"mode": "shared", "image": …} for one behind every slide, "per-slide" with each slide's own "background", else {"mode": "none"}. Choose one when the template sets type on a plain ground and the topic has a place or mood worth showing; leave it "none" when photos carry the carousel or the plain page is the look. Write each ${BACKDROP_WORDS}.`);
  if (video || panorama === false || count < 2) return lines;
  const span = `2 or 3 neighbouring slides, usually from the cover ([1, 3]); the slides under it take no "image" and no photo, so the panorama shows`;
  if (panorama) lines.push(`Neighbouring slides share one wide generated panorama that runs across them as the reader swipes: set panorama {"image": what it shows, a wide scene that reads left to right, ${BACKDROP_WORDS}, "slides": [from, to]}, ${span}.`);
  else lines.push(`You may lay one wide generated panorama across neighbouring slides, so the swipe feels like one picture: panorama {"image": …, "slides": [from, to]}, ${span}. Use it for a place or a journey; leave it out otherwise. The ${BACKDROP_WORDS.replace("in plain", "image is in plain")}.`);
  return lines;
}

const VIDEO_FILE = /\.(mp4|webm|mov|m4v)$/i;
const clamp = (value, [min, max], fallback) => (Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback);

/**
 * A footage slide over its clip ({src, start}): the template's photo-scene
 * plays the video, a type slide sets its text over a video plate, and any
 * other layout becomes a photo-scene with the slide's words as its lines.
 */
function footageScene(scene, slide, clip, { template = null, aspect = "4:5", cue = false } = {}) {
  if (scene.module === "photo-scene") return { ...scene, params: { ...scene.params, media: { src: clip.src, sourceStart: clip.start } } };
  if (scene.plate?.kind === "image" && scene.plate.params?.src === clip.src) {
    const { blur, dim, gradient } = scene.plate.params;
    return { ...scene, plate: { kind: "video", params: { src: clip.src, start: clip.start, ...(blur != null ? { blur } : {}), ...(gradient ? { gradient } : dim != null ? { dim } : {}) } } };
  }
  // The template's full-bleed layout: its words wrapped to the photo width, its title, and the cover's swipe cue.
  const { plate: _plate, ...rest } = scene;
  const { params } = drawSlide(slide, "full-bleed", CAROUSEL_TEMPLATES[template] ?? CAROUSEL_TEMPLATES["cinematic-dark"], { aspect, cue });
  return { ...rest, module: "photo-scene", params: { ...params, media: { src: clip.src, sourceStart: clip.start } } };
}

/** The model's plan → a carousel story. Tooling owns the format, brand, style, timing and medium. */
export function planToStory(plan, { arc, goal, destinations, brand, style = null, template = null, video = false, extras = null }) {
  const dest = CAROUSEL_DESTINATIONS[destinations[0]];
  // A generated image lands at assets/generated/<slide id>.png (make.js), so that is the slide's photo;
  // in a video carousel it is animated into assets/generated/<slide id>.mp4, the slide's clip.
  const generated = (slide, i, ext) => `assets/generated/${slide.id || `slide-${i + 1}`}.${ext}`;
  const slides = (Array.isArray(plan?.slides) ? plan.slides : []).map(plainText).map((slide, i) => {
    if (!slide || typeof slide !== "object") return slide;
    const image = typeof slide.image === "string" && slide.image.trim();
    if (video && (image || (typeof slide.clip === "string" && VIDEO_FILE.test(slide.clip)))) return { ...slide, clip: image && !slide.clip ? generated(slide, i, "mp4") : slide.clip, photo: image && !slide.clip ? generated(slide, i, "mp4") : slide.clip };
    return image && !slide.photo ? { ...slide, photo: generated(slide, i, "png") } : slide;
  });
  // A slide the plan gives as content (no module) is laid out by the template; a slide with a module stays as written.
  const layout = template ? layoutCarousel(template, slides.map((slide) => (slide && typeof slide === "object" ? slide : {})), { aspect: dest.aspect, brand }) : null;
  // A still slide runs SLIDE_SECONDS; a video carousel's slide runs its own seconds (2 to 10).
  let at = 0;
  const scenes = slides.map((slide, i) => {
    const seconds = video ? clamp(slide?.seconds, MOTION_SLIDE_SECONDS, SLIDE_SECONDS) : SLIDE_SECONDS;
    const scene = {
      id: typeof slide?.id === "string" && slide.id ? slide.id : `slide-${i + 1}`,
      ...(layout && !slide?.module ? { module: layout.scenes[i].module, ...(layout.scenes[i].plate ? { plate: layout.scenes[i].plate } : {}) } : { module: slide?.module }),
      start: at,
      end: (at += seconds),
      energy: ["cover", "cta"].includes(slide?.role) ? 2 : 1,
      ...(video && slide?.loop === true ? { loop: true } : {}),
      slide: { role: slide?.role, medium: video ? "motion" : "still", alt: typeof slide?.alt === "string" ? slide.alt : "" },
      params: layout && !slide?.module ? layout.scenes[i].params : slide?.params && typeof slide.params === "object" ? slide.params : {}
    };
    return video && slide?.clip ? footageScene(scene, slide, { src: slide.clip, start: clamp(slide.clip_start, [0, 3600], 0) }, { template, aspect: dest.aspect, cue: i === 0 && slides.length > 1 }) : scene;
  });
  // A generated background (make --background, with --generate): the forced mode, else the plan's.
  const mode = !extras ? "none" : extras.background ?? (CAROUSEL_BACKGROUND_MODES.includes(plan?.background?.mode) ? plan.background.mode : "none");
  const shows = typeof plan?.background?.image === "string" && plan.background.image.trim() ? plainLine(plan.background.image) : null;
  // The panorama: still carousels only (it would cover a footage card), over the plan's span or the first slides.
  const span = extras && !video && scenes.length > 1 && extras.panorama !== false && (extras.panorama || plan?.panorama) ? panoramaSpan(plan?.panorama?.slides, scenes.length) : null;
  if (mode !== "none") scenes.forEach((scene, i) => {
    const own = typeof slides[i]?.background === "string" && slides[i].background.trim();
    // A slide with its own picture (a photo, footage, a brand plate) or under the panorama keeps it.
    if (scene.plate || scene.module === "photo-scene" || PHOTO_MODULES.includes(scene.module) || (span && i >= span[0] - 1 && i <= span[1] - 1) || !(mode === "shared" ? shows : own || shows)) return;
    const src = `assets/generated/${mode === "shared" ? "background" : `${scene.id}-background`}.${video ? "mp4" : "png"}`;
    // Under the template's own reading layer, as a photo behind type is.
    const plate = surfacePlate(CAROUSEL_TEMPLATES[template] ?? {}, "on-image", { photo: src }, layout?.scenes[i]?.grammar ?? "text-card");
    if (plate) scene.plate = video ? { kind: "video", params: { ...plate.params, start: 0 } } : plate;
  });
  const caption = plan?.caption && typeof plan.caption === "object" ? plan.caption : {};
  return {
    schema: STORY_SCHEMA,
    title: typeof plan?.title === "string" && plan.title ? plan.title : "Carousel",
    lane: "motion",
    format: { kind: "carousel", width: dest.width, height: dest.height, fps: 30, duration: scenes.length ? at : SLIDE_SECONDS, platform: destinations[0] },
    carousel: {
      arc: arc ?? plan?.arc,
      goal: goal ?? plan?.goal,
      destinations,
      ...(template ? { template } : {}),
      ...(mode !== "none" ? { background: { mode, ...(shows ? { shows } : {}) } } : {}),
      ...(span ? { panorama: { src: PANORAMA_SRC, slides: span } } : {}),
      caption: { hook: String(caption.hook ?? ""), body: String(caption.body ?? ""), cta: String(caption.cta ?? ""), tags: Array.isArray(caption.tags) ? caption.tags.map(String).filter((tag) => tag.trim()).map((tag) => tag.replace(/^#/, "")) : [] }
    },
    ...(style ? { style } : {}),
    // A style's world camera places each slide's layer on its canvas, which insets the panorama's slices.
    ...(span ? { camera: { mode: "cuts" } } : {}),
    ...layout?.story,
    brand: layout?.story.brand ?? brand,
    audio: null,
    scenes
  };
}

// Where make writes the generated panorama plate.
export const PANORAMA_SRC = "assets/generated/panorama.png";
const panoramaSpan = (given, count) => (Array.isArray(given) && Number.isInteger(given[0]) && Number.isInteger(given[1]) && given[0] >= 1 && given[1] > given[0] && given[1] <= count ? given : [1, Math.min(3, count)]);

/** What a generated background or panorama still needs from the plan: [] when nothing. */
export function extrasErrors(plan, story) {
  const errors = [];
  const { background, panorama } = story.carousel;
  if (background?.mode === "shared" && !background.shows) errors.push('background is shared, so background.image must say what it shows');
  if (background?.mode === "per-slide" && !background.shows && !(plan?.slides ?? []).some((slide) => typeof slide?.background === "string" && slide.background.trim())) errors.push('background is per-slide, so give each slide without a photo its "background"');
  if (panorama) {
    if (!(typeof plan?.panorama?.image === "string" && plan.panorama.image.trim())) errors.push("panorama.image must say what the wide picture shows");
    story.scenes.slice(panorama.slides[0] - 1, panorama.slides[1]).forEach((scene, i) => {
      if (scene.plate || PHOTO_MODULES.includes(scene.module)) errors.push(`slide ${panorama.slides[0] + i} (${scene.id}) is under the panorama, so it takes no "image" or photo`);
    });
  }
  return errors;
}

/** Every reason a planned carousel story cannot go to render. [] when it can. */
export function storyErrors(story, { modules, range, warnings = [], clips = [] }) {
  const ids = modules.map((module) => module.id);
  // Its "not a known module" is said below with the reason (not a slide module).
  const errors = validateStory(story, { modules: ids, moduleParams: validateModuleParams }).errors.filter((line) => !line.includes("is not a known module"));
  const count = story.scenes.length;
  if (range.exact != null ? count !== range.exact : count < range.min || count > range.max) errors.push(`the carousel has ${count} slides; make ${range.exact ?? `${range.min} to ${range.max}`}`);
  story.scenes.forEach((scene, i) => {
    if (!ids.includes(scene.module)) errors.push(`scenes[${i}] (${scene.id}) uses ${scene.module}, which is not a slide module; use one listed under Modules`);
    if (!scene.slide.alt.trim()) errors.push(`scenes[${i}] (${scene.id}) needs alt text that says what the slide shows`);
  });
  // A footage slide stays inside its clip: clip_start + seconds within the clip's length.
  for (const scene of story.scenes) {
    const src = scene.plate?.kind === "video" ? scene.plate.params?.src : scene.params?.media?.src;
    const clip = clips.find((entry) => entry.src === src);
    if (!clip) continue;
    const start = Number(scene.plate?.kind === "video" ? scene.plate.params.start : scene.params.media.sourceStart) || 0;
    if (start + scene.end - scene.start > clip.seconds + 1e-6) errors.push(`${scene.id}: ${clip.src} is ${clip.seconds} s long, so clip_start ${start} + ${round(scene.end - scene.start)} s runs past its end; start earlier or shorten the slide`);
  }
  if (!story.carousel.caption.hook.trim()) errors.push("caption.hook is empty: write the post's first line");
  if (!story.carousel.caption.cta.trim()) errors.push("caption.cta is empty: ask the reader to do the goal");
  for (const id of story.carousel.destinations) errors.push(...destinationProblems(story, id).errors);
  // The check's plan rules (cover, copy, cta …): what `carousel check` would fail goes to the repair now.
  // Story validation already says some (payoff), so a reason it gave is not repeated.
  for (const finding of carouselPlanFindings(story)) if (finding.level === "fail" && !errors.some((line) => line.includes(finding.reason))) errors.push(`${finding.rule}${finding.slide ? ` (slide ${finding.slide})` : ""}: ${finding.reason}`);
  // Module fit: every slide lays out on this canvas (the `launchclip module fit` check), in the same round, so one repair sees every error.
  let resolved;
  try { resolved = resolveStory(JSON.parse(JSON.stringify(story))); } catch (error) { return errors.length ? errors : [`the story does not resolve: ${message(error)}`]; }
  for (const scene of resolved.scenes) {
    if (!ids.includes(scene.module)) continue;
    // As the storyboard planner does: an optional param with a value the module refuses is taken off and its default
    // stands. The drops are kept only when the slide then lays out; otherwise the model gets the first error, not
    // "required" for a param tooling took off. A list entry ("items[0]") is content, so it goes back to the model.
    const original = JSON.stringify(scene.params);
    const dropped = [];
    let first = null;
    for (let tries = 0; ; tries += 1) {
      try {
        resolveModule(scene, resolved, { end: sceneRenderEnd(resolved, scene) });
        const planned = story.scenes.find((entry) => entry.id === scene.id);
        for (const { path, why } of dropped) { dropParam(planned.params, path); warnings.push(`${scene.id}: tooling took params.${path} off (${why})`); }
        break;
      } catch (error) {
        const why = message(error).split(" params: ").at(-1);
        first ??= why;
        const path = tries < 4 ? /params\.([A-Za-z0-9_.[\]]*[A-Za-z0-9_]) (?:must be |must fall |is not supported|leaves no room|needs params\.)/.exec(why)?.[1] : null;
        if (path && dropParam(scene.params, path)) { dropped.push({ path, why }); continue; }
        scene.params = JSON.parse(original);
        errors.push(`scenes ${scene.id} (${scene.module}) does not lay out at ${story.format.width}×${story.format.height}: ${first}`);
        break;
      }
    }
  }
  return errors;
}

/**
 * Plan a carousel. client: runStructured(); options as from make.js.
 * → {story, plan (the model's object, with image requests), attempts: [{ok, errors, usage}], range, warnings}
 * Throws when the repaired plan still fails, listing the errors.
 */
export async function planCarousel({ client, brief, arc = null, goal = null, destinations, slides = null, photos = [], clips = [], video = false, generate = false, background = null, panorama = null, brand, style = null, template = null, say = () => {} }) {
  if (arc && !CAROUSEL_ARCS[arc]) throw new Error(`--arc must be auto or one of ${CAROUSEL_ARC_IDS.join(", ")}`);
  if (goal && !CAROUSEL_GOALS.includes(goal)) throw new Error(`--goal must be one of ${CAROUSEL_GOALS.join(", ")}`);
  const range = slideRange({ arc, destinations, slides });
  if (slides != null && range.exact !== slides) say(`plan: --slides ${slides} is outside what ${arc ?? "the arcs"} and ${destinations.join(", ")} allow; making ${range.exact}`);
  const modules = slideModules({ photos: photos.length > 0 || clips.length > 0 || generate });
  // Without --goal, the arc's usual goal: the given arc's, else the guessed one's, which is what the prompt asks for.
  const goalFor = (picked) => goal ?? DEFAULT_GOAL[picked] ?? "follow";
  // The template: --template, else the brief's best fit for the arc, varied by the style's seed (picked again for an auto arc).
  const pick = (picked) => pickTemplate({ template, brief, arc: picked, images: photos.length > 0 || clips.length > 0 || generate, seed: style ?? "" });
  // An auto arc is guessed from the brief, so the template and its rules are in the first prompt. When the model
  // picks another arc, the template stays if it suits that arc too.
  const guess = arc ?? guessArc(brief);
  const first = pick(guess);
  const templateFor = (picked) => (template || picked === guess || CAROUSEL_TEMPLATES[first].arcs.includes(picked) ? first : pick(picked));
  // Generated backgrounds and the panorama come with --generate: the flags force them, else the plan chooses.
  const extras = generate ? { background, panorama } : null;
  const instructions = planInstructions({ arc, guess, goal: goalFor(guess), destinations, range, modules, photos, generate, video, clips, template: first, extras });
  const attempts = [];
  const warnings = [];
  let input = `Brief: ${brief}\n`;
  for (let round = 0; round < 2; round += 1) {
    const result = await client.runStructured({ instructions, input, schema: CAROUSEL_PLAN_SCHEMA, schemaName: "launchclip_carousel_plan", maxOutputTokens: 8000 });
    let plan = null;
    let errors;
    try { plan = parsePlan(result); } catch (error) { errors = [`carousel_json is not valid JSON: ${message(error)}`]; }
    let story = null;
    if (plan) {
      const picked = arc ?? plan.arc;
      if (!CAROUSEL_ARCS[picked]) errors = [`arc must be one of ${CAROUSEL_ARC_IDS.join(", ")}; got ${picked}`];
      else {
        // The auto arc's count range is the picked arc's, inside the destinations'.
        const own = arc ? range : slideRange({ arc: picked, destinations, slides });
        const chosen = templateFor(picked);
        story = planToStory(plan, { arc: picked, goal: goalFor(guess), destinations, brand, style, template: chosen, video, extras });
        warnings.length = 0;
        const content = (Array.isArray(plan.slides) ? plan.slides : []).filter((slide) => slide && typeof slide === "object" && !slide.module);
        errors = [...(content.length ? templateCopyProblems(chosen, content) : []), ...storyErrors(story, { modules, range: own, warnings, clips }), ...extrasErrors(plan, story)];
      }
    }
    attempts.push({ ok: !errors.length, errors, usage: result?.usage ?? null });
    if (!errors.length) return { story, plan, attempts, range, warnings };
    say(`plan: ${round ? "the repaired plan still has" : "the plan has"} ${errors.length} error(s)${round ? "" : "; one repair call"}`);
    input = `Brief: ${brief}\n\nYour last plan:\n${result?.value?.carousel_json ?? result?.text ?? ""}\n\nIt failed these checks. Return the whole corrected plan:\n- ${errors.join("\n- ")}\n`;
  }
  throw new Error(`the carousel could not be planned; the repaired plan still fails:\n- ${attempts.at(-1).errors.slice(0, 12).join("\n- ")}`);
}

// Slide copy as one plain line: modules refuse control characters and angle brackets, and a line break the model
// wrote is the layout's to make. A slide given as module + params is left as written.
const SLIDE_TEXT = ["headline", "body", "eyebrow", "emphasis", "handle", "alt"];
const plainLine = (value) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f<>]+/g, " ").replace(/\s+/g, " ").trim() : value);
function plainText(slide) {
  if (!slide || typeof slide !== "object" || slide.module) return slide;
  const out = { ...slide };
  for (const key of SLIDE_TEXT) out[key] = plainLine(out[key]);
  if (Array.isArray(out.items)) out.items = out.items.map(plainLine);
  for (const key of ["stat", "quote"]) if (out[key] && typeof out[key] === "object") out[key] = Object.fromEntries(Object.entries(out[key]).map(([k, v]) => [k, plainLine(v)]));
  return out;
}

function parsePlan(result) {
  const raw = result?.value?.carousel_json ?? result?.value ?? result?.text;
  const plan = typeof raw === "string" ? JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) : raw;
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw new Error("expected an object");
  return plan;
}

const round = (value) => Math.round(value * 100) / 100;
const message = (error) => String(error?.message ?? error).split("\n")[0];

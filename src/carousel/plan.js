// launchclip carousel make, the plan: one model call turns a brief into a
// carousel story (docs/CAROUSELS_RFC.md §4, §5, §7), tooling checks it, and
// one repair call gets the errors when it fails. The model client is make's
// (src/make/models.js), so tests pass a fake with runStructured().
import { CAROUSEL_ARCS, CAROUSEL_ARC_IDS, CAROUSEL_DESTINATIONS, CAROUSEL_GOALS, SLIDE_SECONDS, destinationProblems } from "@launchclip/core/carousel.mjs";
import { STORY_SCHEMA, resolveStory, validateStory } from "@launchclip/core/story.mjs";
import { validateModuleParams } from "@launchclip/core/module-schemas.mjs";
import { resolveModule, sceneRenderEnd } from "@launchclip/core/modules.mjs";
import { dropParam } from "../storyboard_planner.js";
import { moduleCatalogue } from "@launchclip/core/planning-prompt.mjs";
import { CAROUSEL_GRAMMARS, CAROUSEL_TEMPLATES, layoutCarousel, pickTemplate, templateCopyProblems } from "@launchclip/core/carousel-templates.mjs";
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
export function planInstructions({ arc, goal, destinations, range, modules, photos, generate, template = null }) {
  const dest = CAROUSEL_DESTINATIONS[destinations[0]];
  const count = range.exact != null ? `exactly ${range.exact} slides` : `${range.min} to ${range.max} slides`;
  const arcs = arc ? `The arc is ${arc}: ${CAROUSEL_ARCS[arc].describe}.` : `Pick the arc that fits the brief best:\n${CAROUSEL_ARC_IDS.map((id) => `- ${id} (${CAROUSEL_ARCS[id].slides.join("-")} slides): ${CAROUSEL_ARCS[id].describe}`).join("\n")}`;
  const lines = [
    "You plan a carousel: a set of slides people swipe through in a social feed. Return one JSON object in carousel_json.",
    "",
    "Shape:",
    '{"title": string, "arc": string, "goal": string, "caption": {"hook": string, "body": string, "cta": string, "tags": [string]}, "slides": [{"id": kebab-case, "role": "cover"|"body"|"payoff"|"cta", "headline": string, "body"?: string, "items"?: [string], "stat"?: {"value", "label", "source"}, "quote"?: {"text", "author", "role"?}, "eyebrow"?: string, "emphasis"?: string, "handle"?: string' + (photos?.length ? ', "photo"?: one of the photos' : "") + ', "alt": string' + (generate ? ', "image": string|null' : "") + "}]}",
    "You write each slide's words; tooling lays them out with a carousel template. Set only the fields a slide needs: a list or a checklist as items (2 to 6 of at most 32 characters); a figure as stat, with its source; a quote with the person who said it; a pair as a headline that opens on the first marker and a body that opens on the second (\"Myth: …\" / \"Fact: …\", \"Before: …\" / \"After: …\", \"Don't: …\" / \"Do: …\"); eyebrow is a small label (at most 24 characters, a step number or section), emphasis a word of the headline to colour, handle the account or link on the cta slide.",
    "",
    arcs,
    `Make ${count}. The canvas is ${dest.width}×${dest.height} (${dest.aspect}) for ${destinations.join(", ")}.`,
    `The goal is ${goal}: the last slide and the caption's cta ask the reader to ${GOAL_CTA[goal]}, and nothing else.`,
    "",
    "What makes a carousel work:",
    "- The cover is the only slide the feed shows. It makes one specific promise (a number, a named result, a sharp question) in 3 to 12 words, readable at thumbnail size, with a reason to swipe.",
    "- One idea per slide: one headline and at most one supporting line or list; body slides stay under 25 words. If an idea needs two reads, split it.",
    "- Roles: the first slide is the cover; at most one cta slide, last. A list, steps, story, data or before-after carousel puts a payoff slide (the summary or checklist worth saving) just before the cta.",
    "- Keep the look the same on every slide (the brand is fixed by tooling), and give the reader a pull to the next slide: a numbered marker, a sentence that continues.",
    "- alt: what the slide shows, for a screen reader (its words and picture), never a file name.",
    "- caption.hook is a second hook for the post's first line (under " + dest.captionPreview + " characters). caption.body adds what did not fit on the slides; it does not repeat them. caption.cta matches the last slide. caption.tags: " + (destinations.some((id) => CAROUSEL_DESTINATIONS[id].tags) ? "3 to 5 topical tags without #." : "an empty list (these destinations do not use tags)."),
    `- Slides are read at phone size, and text that does not fit is refused: a headline at most ${template ? CAROUSEL_TEMPLATES[template].caps.headline : 48} characters, a body line at most ${template ? CAROUSEL_TEMPLATES[template].caps.body : 50} (a slide over a photo holds ${CAROUSEL_GRAMMARS["full-bleed"].caps.body}), list items at most 32. When a check says text is too long, cut it well under the limit.`,
    "- Use only facts the brief gives or that are common knowledge; never invent statistics, customers or quotes.",
    "",
    ...(photos?.length ? [`The user's photos (set a slide's photo to one, as written): ${photos.join(", ")}. A story carousel uses them on most slides.`] : []),
    ...(generate ? ['Slides may have a generated photo: set "image" to what it shows in plain lower-case words (a scene, no brand, person name, text or logo). Every photo slide shares one setting, kind of people and time of day. Leave "image" null on other slides.'] : [])
  ];
  return lines.join("\n");
}

/** The model's plan → a carousel story. Tooling owns the format, brand, style, timing and medium. */
export function planToStory(plan, { arc, goal, destinations, brand, style = null, template = null }) {
  const dest = CAROUSEL_DESTINATIONS[destinations[0]];
  // A generated image lands at assets/generated/<slide id>.png (make.js), so that is the slide's photo.
  const slides = (Array.isArray(plan?.slides) ? plan.slides : []).map(plainText).map((slide, i) => (typeof slide?.image === "string" && slide.image.trim() && !slide.photo ? { ...slide, photo: `assets/generated/${slide.id || `slide-${i + 1}`}.png` } : slide));
  // A slide the plan gives as content (no module) is laid out by the template; a slide with a module stays as written.
  const layout = template ? layoutCarousel(template, slides.map((slide) => (slide && typeof slide === "object" ? slide : {})), { aspect: dest.aspect, brand }) : null;
  const scenes = slides.map((slide, i) => ({
    id: typeof slide?.id === "string" && slide.id ? slide.id : `slide-${i + 1}`,
    ...(layout && !slide?.module ? { module: layout.scenes[i].module, ...(layout.scenes[i].plate ? { plate: layout.scenes[i].plate } : {}) } : { module: slide?.module }),
    start: i * SLIDE_SECONDS,
    end: (i + 1) * SLIDE_SECONDS,
    energy: ["cover", "cta"].includes(slide?.role) ? 2 : 1,
    slide: { role: slide?.role, medium: "still", alt: typeof slide?.alt === "string" ? slide.alt : "" },
    params: layout && !slide?.module ? layout.scenes[i].params : slide?.params && typeof slide.params === "object" ? slide.params : {}
  }));
  const caption = plan?.caption && typeof plan.caption === "object" ? plan.caption : {};
  return {
    schema: STORY_SCHEMA,
    title: typeof plan?.title === "string" && plan.title ? plan.title : "Carousel",
    lane: "motion",
    format: { kind: "carousel", width: dest.width, height: dest.height, fps: 30, duration: Math.max(1, scenes.length) * SLIDE_SECONDS, platform: destinations[0] },
    carousel: {
      arc: arc ?? plan?.arc,
      goal: goal ?? plan?.goal,
      destinations,
      ...(template ? { template } : {}),
      caption: { hook: String(caption.hook ?? ""), body: String(caption.body ?? ""), cta: String(caption.cta ?? ""), tags: Array.isArray(caption.tags) ? caption.tags.map(String).filter((tag) => tag.trim()).map((tag) => tag.replace(/^#/, "")) : [] }
    },
    ...(style ? { style } : {}),
    ...layout?.story,
    brand: layout?.story.brand ?? brand,
    audio: null,
    scenes
  };
}

/** Every reason a planned carousel story cannot go to render. [] when it can. */
export function storyErrors(story, { modules, range, warnings = [] }) {
  const ids = modules.map((module) => module.id);
  // Its "not a known module" is said below with the reason (not a slide module).
  const errors = validateStory(story, { modules: ids, moduleParams: validateModuleParams }).errors.filter((line) => !line.includes("is not a known module"));
  const count = story.scenes.length;
  if (range.exact != null ? count !== range.exact : count < range.min || count > range.max) errors.push(`the carousel has ${count} slides; make ${range.exact ?? `${range.min} to ${range.max}`}`);
  story.scenes.forEach((scene, i) => {
    if (!ids.includes(scene.module)) errors.push(`scenes[${i}] (${scene.id}) uses ${scene.module}, which is not a slide module; use one listed under Modules`);
    if (!scene.slide.alt.trim()) errors.push(`scenes[${i}] (${scene.id}) needs alt text that says what the slide shows`);
  });
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
export async function planCarousel({ client, brief, arc = null, goal = null, destinations, slides = null, photos = [], generate = false, brand, style = null, template = null, say = () => {} }) {
  if (arc && !CAROUSEL_ARCS[arc]) throw new Error(`--arc must be auto or one of ${CAROUSEL_ARC_IDS.join(", ")}`);
  if (goal && !CAROUSEL_GOALS.includes(goal)) throw new Error(`--goal must be one of ${CAROUSEL_GOALS.join(", ")}`);
  const range = slideRange({ arc, destinations, slides });
  if (slides != null && range.exact !== slides) say(`plan: --slides ${slides} is outside what ${arc ?? "the arcs"} and ${destinations.join(", ")} allow; making ${range.exact}`);
  const modules = slideModules({ photos: photos.length > 0 || generate });
  // Without --goal, the arc's usual goal; the auto arc's is settled after the model picks it.
  const goalFor = (picked) => goal ?? DEFAULT_GOAL[picked] ?? "follow";
  // The template: --template, else the brief's best fit for the arc, varied by the style's seed (picked again for an auto arc).
  const templateFor = (picked) => pickTemplate({ template, brief, arc: picked, images: photos.length > 0 || generate, seed: style ?? "" });
  const instructions = planInstructions({ arc, goal: goal ?? (arc ? goalFor(arc) : "the arc's: save for list, steps and data; comment for myth-fact; install for an ad; follow otherwise"), destinations, range, modules, photos, generate, template: arc || template ? templateFor(arc) : null });
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
        story = planToStory(plan, { arc: picked, goal: goalFor(picked), destinations, brand, style, template: chosen });
        warnings.length = 0;
        const content = (Array.isArray(plan.slides) ? plan.slides : []).filter((slide) => slide && typeof slide === "object" && !slide.module);
        errors = [...(content.length ? templateCopyProblems(chosen, content) : []), ...storyErrors(story, { modules, range: own, warnings })];
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

const message = (error) => String(error?.message ?? error).split("\n")[0];

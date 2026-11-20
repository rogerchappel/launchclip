// One sample carousel per template (kit/core/carousel-templates.mjs), written
// through the planner's own path (planToStory), so each sample is what
// `carousel make` builds from that content. Figures are illustrative.
//   node scripts/carousel-template-samples.mjs   → examples/carousel/<template>-4x5/ (and numbered-steps-9x16)
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planToStory } from "../src/carousel/plan.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Stand-in photos already in the repo: crops of a procedural landscape and the demo app's dashboard.
const PHOTOS = Object.fromEntries(["ridge", "ridge-sun", "ridge-dusk", "dashboard"].map((name) => [name, `examples/carousel/_photos/${name}.jpg`]));

const fonts = (display, body, meta = "jetbrains-mono") => ({ display, body, meta });
const colors = (bg, primary, accent, paper, ink = bg) => ({ bg, primary, accent, ink, paper });
const s = (id, role, fields) => ({ id, role, alt: fields.alt ?? [fields.eyebrow, fields.headline, fields.body, ...(fields.items ?? []), fields.stat && `${fields.stat.value} ${fields.stat.label}`, fields.quote && `“${fields.quote.text}” ${fields.quote.author}`, fields.photo && "over a photo"].filter(Boolean).join(". "), ...fields });

const numberedSteps = {
  arc: "how-to", goal: "save",
  brand: { colors: colors("#0d0d0f", "#f2c14e", "#f06b4f", "#f4f4f4"), fonts: fonts("oswald", "plus-jakarta-sans"), name: "Field Notes" },
  caption: { hook: "A brief takes an hour. Skipping it costs a week.", body: "Four steps, one page, before the first commit.", cta: "Save this for your next kickoff.", tags: ["product", "writing", "planning"] },
  slides: [
    s("cover", "cover", { headline: "How to write the brief before you build", photo: "ridge-dusk" }),
    s("step-1", "body", { headline: "Name the problem in one sentence" }),
    s("step-2", "body", { headline: "Say who it is for, by name" }),
    s("step-3", "body", { headline: "Write what done looks like" }),
    s("brief", "payoff", { headline: "The brief, in four lines", items: ["The problem", "Who it is for", "What done looks like", "What is out of scope"] }),
    s("cta", "cta", { headline: "Save this for your next kickoff", emphasis: "Save", handle: "notes.test" })
  ]
};

export const SAMPLES = {
  "caption-block": {
    arc: "listicle", goal: "save",
    brand: { colors: colors("#3f1c22", "#f06b4f", "#f2c14e", "#fff1d8"), fonts: fonts("big-shoulders-display", "dm-sans"), name: "Slow Mornings" },
    caption: { hook: "Most morning routines fail by Wednesday.", body: "Three that survive a busy week.", cta: "Save this for Monday.", tags: ["habits", "mornings"] },
    slides: [
      s("cover", "cover", { eyebrow: "Field guide", headline: "3 morning habits that survive a busy week", photo: "ridge-sun" }),
      s("light", "body", { eyebrow: "01", headline: "Get outside before the screen", body: "Ten minutes of daylight sets the clock for the day.", photo: "ridge" }),
      s("plan", "body", { eyebrow: "02", headline: "Pick one task before the inbox", body: "Write it on paper, not in the app.", photo: "ridge-dusk" }),
      s("list", "payoff", { headline: "Save this checklist", items: ["Daylight first", "One task on paper", "Inbox after ten"], photo: "ridge-sun" }),
      s("cta", "cta", { headline: "Save it for Monday", emphasis: "Save", handle: "slowmornings.test" })
    ]
  },
  "cinematic-dark": {
    arc: "listicle", goal: "follow",
    brand: { colors: colors("#0b0b0d", "#edebe7", "#f2c14e", "#ffffff"), fonts: fonts("inter", "dm-sans"), name: "Steady Coach" },
    caption: { hook: "Motivation is a bad plan.", body: "Three rules that work on the days it does not show up.", cta: "Follow for one rule a week.", tags: ["discipline", "habits", "coaching"] },
    slides: [
      s("cover", "cover", { headline: "Train the habit, not the goal", body: "Start small.", photo: "ridge" }),
      s("small", "body", { headline: "Make it too small to skip", body: "Ten minutes you keep beat an hour you dread.", photo: "ridge-dusk" }),
      s("same", "body", { headline: "Same time, same place", body: "Decide once, then stop deciding.", photo: "ridge-sun" }),
      s("miss", "payoff", { headline: "Never miss twice", body: "One off day is life. Two is a new habit.", photo: "ridge" }),
      s("cta", "cta", { headline: "Follow for one rule a week", emphasis: "Follow", handle: "steadycoach.test", photo: "ridge-dusk" })
    ]
  },
  "cinematic-light": {
    arc: "how-to", goal: "save",
    brand: { colors: colors("#17191b", "#2f5d50", "#b8401f", "#ffffff"), fonts: fonts("inter", "dm-sans"), name: "Calm Mornings" },
    caption: { hook: "Calm mornings are built the night before.", body: "Three things to do before bed.", cta: "Save it for tonight.", tags: ["wellness", "sleep"] },
    slides: [
      s("cover", "cover", { headline: "A calmer morning starts tonight", body: "Three small things.", photo: "ridge-sun" }),
      s("lay-out", "body", { headline: "Lay out tomorrow's first hour", body: "Clothes, kettle, the one task. Nothing to decide.", photo: "ridge" }),
      s("screens", "body", { headline: "Put the phone in another room", body: "The alarm clock was invented for a reason.", photo: "ridge-dusk" }),
      s("wrap", "payoff", { headline: "Write tomorrow's one task down", body: "Your head lets go of what paper holds.", photo: "ridge-sun" }),
      s("cta", "cta", { headline: "Save it for tonight", emphasis: "Save", handle: "calmmornings.test", photo: "ridge" })
    ]
  },
  "plain-note": {
    arc: "single", goal: "follow",
    brand: { colors: colors("#ffffff", "#17191b", "#1d6fd8", "#ffffff", "#17191b"), fonts: fonts("inter", "inter"), name: "Founder Notes" },
    caption: { hook: "Something I wish I had heard at the start.", body: "", cta: "Follow for more notes like this.", tags: [] },
    slides: [
      s("note", "cover", { headline: "Most startups die building the wrong thing, very well.", handle: "founder.notes" })
    ]
  },
  "plain-note-dark": {
    arc: "quote", goal: "follow",
    brand: { colors: colors("#08090a", "#f7f7f7", "#f2c14e", "#f7f7f7"), fonts: fonts("inter", "inter"), name: "Weekly Ship" },
    caption: { hook: "Notes on shipping, from a year of doing it weekly.", body: "", cta: "Follow for a note a day.", tags: [] },
    slides: [
      s("one", "cover", { headline: "A deadline you keep to yourself is only a wish.", emphasis: "wish" }),
      s("plan", "body", { headline: "A deadline you announce is a plan. Say it out loud.", emphasis: "announce" }),
      s("two", "body", { headline: "The first version is for learning, not for impressing anyone. Ship it.", emphasis: "learning" }),
      s("cta", "cta", { headline: "Follow for a note a day", emphasis: "Follow", handle: "weekly.ship" })
    ]
  },
  "numbered-steps": numberedSteps,
  "paper-story": {
    arc: "story", goal: "follow",
    brand: { colors: colors("#f4ebdd", "#b65335", "#2f5d50", "#f4ebdd", "#57241d"), fonts: fonts("playfair-display", "dm-sans") },
    caption: { hook: "We nearly shipped the wrong product.", body: "How one conversation changed the roadmap.", cta: "Follow for the next chapter.", tags: ["founder", "product"] },
    slides: [
      s("cover", "cover", { eyebrow: "A product story", headline: "The week we nearly shipped the wrong thing", photo: "ridge-dusk" }),
      s("call", "body", { headline: "One customer call changed the roadmap", body: "They never opened the feature we loved most.", photo: "ridge" }),
      s("cut", "body", { headline: "So we cut it, and shipped the boring part", body: "Exports. Nobody tweets about exports.", photo: "ridge-sun" }),
      s("lesson", "payoff", { eyebrow: "The lesson", headline: "Ask what they do on Monday morning", body: "Not what they wish they did." }),
      s("cta", "cta", { headline: "Follow for the next chapter", emphasis: "Follow", handle: "quietbuild.test" })
    ]
  },
  "bold-statement": {
    arc: "quote", goal: "follow",
    brand: { colors: colors("#0a1a3f", "#0745ec", "#d9ff55", "#fff0d7"), fonts: fonts("inter", "inter") },
    caption: { hook: "What we believe about building software.", body: "Three lines we hold ourselves to.", cta: "Follow if you agree.", tags: [] },
    slides: [
      s("cover", "cover", { headline: "Small teams ship better software", emphasis: "ship better" }),
      s("value-1", "body", { headline: "Fewer meetings, more decisions", emphasis: "more decisions" }),
      s("value-2", "body", { headline: "Write it down or it did not happen", emphasis: "Write it down" }),
      s("cta", "cta", { headline: "Follow if you agree", emphasis: "Follow", handle: "smallteams.test" })
    ]
  },
  "pull-quote": {
    arc: "quote", goal: "follow",
    brand: { colors: colors("#f5f0e5", "#751a23", "#2f5d50", "#f5f0e5", "#25221f"), fonts: fonts("dm-serif-display", "inter") },
    caption: { hook: "Two lines worth keeping on the wall.", body: "From two people who wrote the field's early rules.", cta: "Follow for a line a day.", tags: [] },
    slides: [
      s("cover", "cover", { quote: { text: "Simplicity is prerequisite for reliability.", author: "Edsger W. Dijkstra" }, emphasis: "Simplicity" }),
      s("knuth", "body", { quote: { text: "Premature optimization is the root of all evil.", author: "Donald Knuth" } }),
      s("cta", "cta", { headline: "Follow for a line a day", emphasis: "Follow", handle: "slowcode.test" })
    ]
  },
  "photo-essay": {
    arc: "story", goal: "follow",
    brand: { colors: colors("#f5f2ea", "#ad5639", "#2f5d50", "#f5f2ea", "#202020"), fonts: fonts("fraunces", "dm-sans") },
    caption: { hook: "Three mornings on the ridge.", body: "A small project about getting up early.", cta: "Follow for the rest of the series.", tags: ["photography", "outdoors"] },
    slides: [
      s("cover", "cover", { eyebrow: "Photo essay", headline: "Three mornings on the ridge", photo: "ridge" }),
      s("first", "body", { eyebrow: "Day one", headline: "Fog until seven, then everything at once", body: "The light arrives faster than you can set up.", photo: "ridge-sun" }),
      s("second", "body", { eyebrow: "Day two", headline: "The quiet before anyone else is up", body: "Nothing to do but wait for the colour.", photo: "ridge-dusk" }),
      s("note", "payoff", { eyebrow: "What I learned", headline: "Get there an hour early", body: "The best frame is never the one you planned." }),
      s("cta", "cta", { headline: "Follow for the rest of the series", emphasis: "Follow", handle: "ridgelight.test" })
    ]
  },
  "lit-window": {
    arc: "ad", goal: "install",
    brand: { colors: colors("#0b1020", "#5b84ff", "#22d3a6", "#f4f6fb"), fonts: fonts("sora", "inter") },
    caption: { hook: "Release day should be boring.", body: "Every check, review and rollout in one place.", cta: "Install it free.", tags: [] },
    slides: [
      s("cover", "cover", { headline: "Ship releases without the panic", body: "Every check, one screen", photo: "dashboard" }),
      s("one-view", "body", { headline: "Every check in one view", body: "Builds, reviews and rollouts, live.", photo: "dashboard" }),
      s("proof", "payoff", { headline: "Less prep, more shipping", stat: { value: "80%", label: "less time on release prep", source: "Beta teams, 2026 (illustrative)" } }),
      s("cta", "cta", { headline: "Install it free today", emphasis: "free", body: "Free for teams of five", handle: "shipdeck.test" })
    ]
  }
};

// Sample folder → [template, sample, destinations].
export const SAMPLE_PROJECTS = {
  ...Object.fromEntries(Object.keys(SAMPLES).map((id) => [`${id}-4x5`, [id, SAMPLES[id], ["instagram"]]])),
  "numbered-steps-9x16": ["numbered-steps", numberedSteps, ["tiktok"]]
};

/** A sample's story: its content through the planner's template path; photos at assets/photos/<name>.jpg. */
export function sampleStory(folder) {
  const [template, sample, destinations] = SAMPLE_PROJECTS[folder];
  const slides = sample.slides.map((slide) => (slide.photo ? { ...slide, photo: `assets/photos/${slide.photo}.jpg` } : slide));
  const story = planToStory({ title: `${template} sample`, ...sample, slides }, { arc: sample.arc, goal: sample.goal, destinations, brand: sample.brand, template });
  return { ...story, title: `${template} (sample carousel template, ${destinations[0]})`, notes: "Sample for a carousel template (docs/guide/carousels.md, Templates), written by scripts/carousel-template-samples.mjs. Figures, names and handles are illustrative. Photos are stand-ins already in the repo." };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const folder of Object.keys(SAMPLE_PROJECTS)) {
    const dir = path.join(ROOT, "examples", "carousel", folder);
    const story = sampleStory(folder);
    const photos = [...new Set(SAMPLE_PROJECTS[folder][1].slides.map((slide) => slide.photo).filter(Boolean))];
    if (photos.length) await mkdir(path.join(dir, "assets", "photos"), { recursive: true });
    for (const name of photos) await copyFile(path.join(ROOT, PHOTOS[name]), path.join(dir, "assets", "photos", `${name}.jpg`));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "storyboard.json"), `${JSON.stringify(story, null, 2)}\n`);
    console.log(`wrote examples/carousel/${folder}`);
  }
}

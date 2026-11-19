// One sample carousel per template (kit/core/carousel-templates.mjs), written
// through the planner's own path (planToStory), so each sample is what
// `carousel make` builds from that content. Figures are illustrative.
//   node scripts/carousel-template-samples.mjs   → examples/carousel/<template>-4x5/ (and study-notes-9x16)
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planToStory } from "../src/carousel/plan.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Stand-in photos already in the repo (a procedural landscape, the demo app's dashboard).
const PHOTOS = { ridge: "examples/carousel/_photos/ridge.jpg", dashboard: "examples/carousel/_photos/dashboard.jpg" };

const fonts = (display, body, meta = "jetbrains-mono") => ({ display, body, meta });
const s = (id, role, fields) => ({ id, role, alt: fields.alt ?? [fields.eyebrow, fields.headline, fields.body, ...(fields.items ?? []), fields.quote && `“${fields.quote.text}” ${fields.quote.author}`].filter(Boolean).join(". "), ...fields });

const studyNotes = {
  arc: "listicle", goal: "save",
  brand: { colors: { bg: "#13151a", primary: "#ffb020", accent: "#ff6b5f", ink: "#13151a", paper: "#f5f1e8" }, fonts: fonts("bricolage-grotesque", "inter") },
  caption: { hook: "Most teams are not slow. They wait.", body: "Three habits that take the waiting out of a week.", cta: "Save this for your next planning meeting.", tags: ["productivity", "engineering", "teams"] },
  slides: [
    s("cover", "cover", { eyebrow: "Field guide", headline: "3 habits of teams that ship daily", emphasis: "ship daily" }),
    s("habit-1", "body", { eyebrow: "01", headline: "Decide in the thread", body: "A written call travels further than a meeting." }),
    s("habit-2", "body", { eyebrow: "02", headline: "Ship the smallest change that works", body: "Small diffs review fast and roll back clean." }),
    s("habit-3", "body", { eyebrow: "03", headline: "Review the same day", emphasis: "same day", body: "A day-old review costs a context switch." }),
    s("checklist", "payoff", { headline: "Save this checklist", items: ["Decide in the thread", "Ship the smallest change", "Review the same day"] }),
    s("cta", "cta", { headline: "Save it for your next sprint", emphasis: "Save", handle: "fastteams.test" })
  ]
};

export const SAMPLES = {
  "product-proof": {
    arc: "ad", goal: "install",
    brand: { colors: { bg: "#0b1020", primary: "#5b84ff", accent: "#22d3a6", ink: "#0b1020", paper: "#f4f6fb" }, fonts: fonts("sora", "inter") },
    caption: { hook: "Release day should be boring.", body: "Every check, review and rollout in one place.", cta: "Install it free.", tags: [] },
    slides: [
      s("cover", "cover", { headline: "Ship releases without the panic", body: "Now on iOS and web", photo: "dashboard" }),
      s("one-view", "body", { headline: "Every check in one view", body: "Builds, reviews and rollouts on one screen, live.", photo: "dashboard" }),
      s("roll-back", "body", { eyebrow: "When it breaks", headline: "Roll back in one tap", body: "Undo a release before your users notice.", photo: "dashboard" }),
      s("proof", "payoff", { headline: "Less prep, more shipping", stat: { value: "80%", label: "less time on release prep", source: "Beta teams, 2026 (illustrative)" } }),
      s("cta", "cta", { headline: "Install it free today", emphasis: "free", body: "Free for teams of five", handle: "shipdeck.test" })
    ]
  },
  "study-notes": studyNotes,
  "field-notes": {
    arc: "how-to", goal: "save",
    brand: { colors: { bg: "#f3efe6", primary: "#b8401f", accent: "#2f5d50", ink: "#1b1a17", paper: "#f3efe6" }, fonts: fonts("fraunces", "dm-sans") },
    caption: { hook: "A week of building can hide a day of thinking.", body: "Four lines to write before the first commit.", cta: "Save this for your next kickoff.", tags: ["writing", "product"] },
    slides: [
      s("cover", "cover", { eyebrow: "How to", headline: "Write a one-page brief before you build", emphasis: "one-page brief" }),
      s("step-1", "body", { eyebrow: "Step 1", headline: "Name the problem in one sentence", body: "If it takes a paragraph, it is two problems." }),
      s("step-2", "body", { eyebrow: "Step 2", headline: "Say who it is for", body: "One reader, named, beats everyone in general." }),
      s("step-3", "body", { eyebrow: "Step 3", headline: "Write what done looks like", body: "A test you could run, not a feeling." }),
      s("brief", "payoff", { headline: "The brief, in four lines", items: ["The problem", "Who it is for", "What done looks like", "What is out of scope"] }),
      s("cta", "cta", { headline: "Save this for your next kickoff", emphasis: "Save", handle: "notes.test" })
    ]
  },
  "photo-diary": {
    arc: "story", goal: "follow",
    brand: { colors: { bg: "#101418", primary: "#f2a65a", accent: "#8fb8de", ink: "#101418", paper: "#f6f1ea" }, fonts: fonts("dm-serif-display", "manrope") },
    caption: { hook: "I am not a morning person. I tried anyway.", body: "A year of running before work, in five pictures.", cta: "Follow for the next twelve months.", tags: ["running", "habits", "mornings"] },
    slides: [
      s("cover", "cover", { headline: "The year I ran before work", body: "and what it changed", photo: "ridge" }),
      s("week-one", "body", { headline: "Week one was mostly walking", body: "Out at six every day", photo: "ridge" }),
      s("spring", "body", { headline: "By spring the hills felt shorter", body: "Mornings got easier", photo: "ridge" }),
      s("lesson", "payoff", { eyebrow: "The lesson", headline: "Start smaller than feels useful", body: "Ten minutes you keep beat an hour you skip." }),
      s("cta", "cta", { headline: "Follow for the next year", emphasis: "Follow", handle: "morningmiles.test", photo: "ridge" })
    ]
  },
  "quiet-quote": {
    arc: "quote", goal: "follow",
    brand: { colors: { bg: "#1a1033", primary: "#c99bff", accent: "#f78fc4", ink: "#1a1033", paper: "#f8f5ff" }, fonts: fonts("instrument-serif", "inter") },
    caption: { hook: "Two lines worth keeping on the wall.", body: "From two people who wrote the field's early rules.", cta: "Follow for a line a day.", tags: [] },
    slides: [
      s("cover", "cover", { quote: { text: "Simplicity is prerequisite for reliability.", author: "Edsger W. Dijkstra" }, emphasis: "Simplicity" }),
      s("knuth", "body", { quote: { text: "Premature optimization is the root of all evil.", author: "Donald Knuth" } }),
      s("cta", "cta", { headline: "Follow for a line a day", emphasis: "Follow", handle: "slowcode.test" })
    ]
  },
  "signal-report": {
    arc: "data", goal: "save",
    brand: { colors: { bg: "#07131a", primary: "#2dd4bf", accent: "#facc15", ink: "#07131a", paper: "#eef6f7" }, fonts: fonts("space-grotesk", "inter") },
    caption: { hook: "When you ship matters as much as what.", body: "Patterns from a sample of release notes.", cta: "Save the findings.", tags: ["devops", "data"] },
    slides: [
      s("cover", "cover", { eyebrow: "Release report", headline: "What a year of release notes taught us", emphasis: "release notes" }),
      s("midweek", "body", { headline: "Midweek wins", stat: { value: "62%", label: "of releases shipped Tuesday or Wednesday", source: "Sample data (illustrative)" } }),
      s("friday", "body", { headline: "Fridays cost more", stat: { value: "3.4×", label: "more rollbacks on Friday releases", source: "Sample data (illustrative)" } }),
      s("takeaways", "payoff", { headline: "What to take from it", items: ["Ship midweek", "Keep diffs small", "Keep Friday for fixes"] }),
      s("cta", "cta", { headline: "Save the findings", emphasis: "Save", handle: "releasenotes.test" })
    ]
  },
  "myth-split": {
    arc: "myth-fact", goal: "comment",
    brand: { colors: { bg: "#160c0c", primary: "#ff5a48", accent: "#ffd166", ink: "#160c0c", paper: "#fff4ec" }, fonts: fonts("anton", "inter") },
    caption: { hook: "Remote work is not what the headlines say.", body: "Two beliefs worth dropping.", cta: "Comment the myth you used to believe.", tags: [] },
    slides: [
      s("cover", "cover", { headline: "Remote work myths, busted", emphasis: "busted" }),
      s("talk", "body", { headline: "Myth: remote teams talk less", body: "Fact: they write more, and it lasts" }),
      s("meetings", "body", { headline: "Myth: meetings keep teams aligned", body: "Fact: written decisions do it faster" }),
      s("cta", "cta", { headline: "Which myth did you believe?", emphasis: "myth", handle: "remotely.test" })
    ]
  },
  "then-now": {
    arc: "before-after", goal: "follow",
    brand: { colors: { bg: "#0f1512", primary: "#7ddc6f", accent: "#ff8a4c", ink: "#0f1512", paper: "#f1f5ee" }, fonts: fonts("syne", "plus-jakarta-sans") },
    caption: { hook: "We used to lose two days to every release.", body: "What we changed, and what it gave back.", cta: "Follow for the playbook.", tags: [] },
    slides: [
      s("cover", "cover", { headline: "Release prep: from days to hours", body: "Swipe for the change", photo: "dashboard" }),
      s("train", "body", { headline: "Before: a release train every week", body: "After: every merge ships on its own" }),
      s("checks", "body", { headline: "Before: a checklist in a doc", body: "After: checks that run themselves" }),
      s("result", "payoff", { headline: "The result", stat: { value: "80%", label: "less time on release prep", source: "Sample team, 2026 (illustrative)" } }),
      s("cta", "cta", { headline: "Follow for the playbook", emphasis: "Follow", handle: "shipdeck.test" })
    ]
  }
};

// Sample folder → [template, sample, destinations].
export const SAMPLE_PROJECTS = {
  ...Object.fromEntries(Object.keys(SAMPLES).map((id) => [`${id}-4x5`, [id, SAMPLES[id], ["instagram"]]])),
  "study-notes-9x16": ["study-notes", studyNotes, ["tiktok"]]
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

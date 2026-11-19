// launchclip carousel export <project> [--dest <id>[,<id>…]] [--link <url>] [--json]
// (docs/CAROUSELS_RFC.md §7, §8, §9.1, §11). Reads storyboard.json and the
// rendered slides in carousel/<dest>/ (NN.png or NN.jpg, NN.mp4 for a motion
// slide) and writes, per destination: slides.pdf where it takes a PDF,
// cards.json where it takes ad cards, caption.md and alt.json; then
// carousel/CAROUSEL.json for every destination.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CAROUSEL_DESTINATIONS, CAROUSEL_DESTINATION_IDS, carouselProblems, carouselSlides, destinationProblems, isCarousel, slideStem } from "@launchclip/core/carousel.mjs";
import { hashtagList } from "../publish_manifest.js";
import { writePdf } from "./pdf.js";

export const CAROUSEL_EXPORT_VERSION = "launchclip.carousel.v1";

// shortcut: Meta carousel card lengths are from public guidance as of 2026-11
// (Meta's ads guide recommendations), not enforced limits; check before relying on them.
export const META_CARD_HEADLINE = 32;
export const META_CARD_DESCRIPTION = 18;
export const META_MAX_CARDS = 10;

export async function run(target, flags = {}, io = {}) {
  const project = path.resolve(target);
  const story = await readJson(path.join(project, "storyboard.json"));
  if (!story) throw new Error(`launchclip carousel export: no storyboard.json in ${project}`);
  if (!isCarousel(story)) throw new Error("launchclip carousel export: storyboard.json is not a carousel (format.kind \"carousel\")");
  const problems = carouselProblems(story);
  if (problems.length) throw new Error(`launchclip carousel export: the carousel has problems:\n- ${problems.join("\n- ")}`);

  const root = path.join(project, "carousel");
  const ids = destinationIds(story, flags.dest);
  const destinations = {};
  for (const id of ids) destinations[id] = await exportDestination(story, id, path.join(root, id), flags);

  const slides = carouselSlides(story);
  const report = {
    schema: CAROUSEL_EXPORT_VERSION,
    title: story.title ?? null,
    arc: story.carousel?.arc ?? null,
    goal: story.carousel?.goal ?? null,
    slides: slides.map((scene, index) => ({ index: index + 1, id: scene.id, role: scene.slide.role, medium: scene.slide.medium, alt: scene.slide.alt ?? "" })),
    destinations,
    check: await readJson(path.join(root, "check.json"))
  };
  await mkdir(root, { recursive: true });
  await writeJson(path.join(root, "CAROUSEL.json"), report);

  if (io.stdout) io.stdout.write(flags.json ? `${JSON.stringify(report, null, 2)}\n` : summary(report, root));
  return report;
}

function destinationIds(story, dest) {
  const given = typeof dest === "string" ? dest.split(",").map((id) => id.trim()).filter(Boolean) : null;
  const ids = given?.length ? given : story.carousel?.destinations ?? [story.format?.platform].filter((id) => CAROUSEL_DESTINATION_IDS.includes(id));
  if (!ids.length) throw new Error(`launchclip carousel export: no destination; pass --dest ${CAROUSEL_DESTINATION_IDS.join(",")} or set carousel.destinations`);
  return [...new Set(ids)];
}

async function exportDestination(story, id, dir, flags) {
  const { errors, warnings } = destinationProblems(story, id);
  const base = { status: "exported", dir, files: [], warnings: [...warnings], errors: [...errors], check: await readJson(path.join(dir, "check.json")) };
  if (errors.length) return { ...base, status: "skipped", reason: "the carousel does not fit this destination" };

  const dest = CAROUSEL_DESTINATIONS[id];
  const slides = carouselSlides(story);
  const imageType = dest.exports.includes("jpg") ? "jpg" : "png";
  const found = slides.map((scene, index) => slideFiles(dir, slideStem(index, slides.length), scene.slide.medium === "motion" && dest.motion));
  const missing = found.flatMap((files, index) => files.missing.map((name) => `slide ${index + 1} (${slides[index].id}): ${name}`));
  if (missing.length) return { ...base, status: "skipped", reason: `missing renders; run launchclip carousel render first`, missing };

  // An image-only destination that wants jpg gets one from the render's png.
  for (const files of found) {
    if (path.extname(files.image).slice(1) === imageType || imageType !== "jpg") continue;
    const jpg = files.image.replace(/\.png$/, ".jpg");
    await (await sharp())(files.image).flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toFile(jpg);
    files.image = jpg;
  }
  const ordered = found.flatMap((files) => [files.image, files.video].filter(Boolean));
  const name = (file) => path.basename(file);
  const out = { ...base, files: ordered.map(name) };

  if (dest.exports.includes("pdf")) {
    await writeFile(path.join(dir, "slides.pdf"), await slidesPdf(found.map((files) => files.image)));
    out.files.push("slides.pdf");
  }
  if (dest.exports.includes("cards")) {
    const sheet = cardSheet(story, found.map((files) => name(files.video ?? files.image)), flags.link);
    await writeJson(path.join(dir, "cards.json"), sheet);
    out.warnings.push(...sheet.warnings);
    out.files.push("cards.json");
  }

  const caption = postCaption(story, id);
  await writeFile(path.join(dir, "caption.md"), caption.markdown);
  if (caption.over) out.warnings.push(`the hook is ${caption.hook.length} characters; ${id} shows ${dest.captionPreview} before cutting it`);
  out.caption = { hook_length: caption.hook.length, preview: dest.captionPreview, over: caption.over, tags: caption.tags };

  const alt = slides.flatMap((scene, index) => [found[index].image, found[index].video].filter(Boolean).map((file) => ({ file: name(file), slide: index + 1, alt: scene.slide.alt ?? "" })));
  slides.forEach((scene, index) => { if (!scene.slide.alt?.trim()) out.warnings.push(`slide ${index + 1} (${scene.id}) has no alt text`); });
  await writeJson(path.join(dir, "alt.json"), alt);
  out.files.push("caption.md", "alt.json");
  return out;
}

// Rendered files for one slide: its still (png, else jpg) and, when the
// destination shows motion and the slide moves, its mp4.
function slideFiles(dir, stem, wantVideo) {
  const image = ["png", "jpg"].map((ext) => path.join(dir, `${stem}.${ext}`)).find((file) => existsSync(file));
  const video = path.join(dir, `${stem}.mp4`);
  const missing = [];
  if (!image) missing.push(`${stem}.png`);
  if (wantVideo && !existsSync(video)) missing.push(`${stem}.mp4`);
  return { image, video: wantVideo ? video : null, missing };
}

async function slidesPdf(images) {
  const make = await sharp();
  const pages = [];
  for (const file of images) {
    const { data, info } = await make(file).flatten({ background: "#ffffff" }).toColourspace("srgb").jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
    pages.push({ jpeg: data, width: info.width, height: info.height });
  }
  return writePdf(pages);
}

/** The ad card sheet (§9.1): headline, description and link per card, within Meta's lengths. */
export function cardSheet(story, files, link) {
  const slides = carouselSlides(story);
  if (slides.length > META_MAX_CARDS) throw new Error(`a Meta carousel ad takes at most ${META_MAX_CARDS} cards; this carousel has ${slides.length}`);
  const caption = story.carousel?.caption ?? {};
  const warnings = [];
  if (!link) warnings.push("no link for the cards; pass --link <url>");
  const cards = slides.map((scene, index) => {
    const params = scene.params ?? {};
    const headline = firstText(params.headline, params.title, params.text, scene.slide.alt);
    const description = firstText(params.subhead, params.subtitle, params.body, params.description, scene.slide.role === "cta" ? caption.cta : "");
    const card = { card: index + 1, file: files[index], headline: fit(headline, META_CARD_HEADLINE), description: fit(description, META_CARD_DESCRIPTION), link: link ?? null };
    for (const [field, text] of [["headline", headline], ["description", description]]) if (card[field] !== text) warnings.push(`card ${index + 1} ${field} cut to ${field === "headline" ? META_CARD_HEADLINE : META_CARD_DESCRIPTION} characters: "${text}"`);
    return card;
  });
  return { primary_text: [caption.hook, caption.body].filter(Boolean).join("\n\n"), cards, warnings };
}

/** The post caption for one destination (§7): hook, body, cta, tags where the platform uses them. */
export function postCaption(story, id) {
  const dest = CAROUSEL_DESTINATIONS[id];
  const caption = story.carousel?.caption ?? {};
  const cover = carouselSlides(story)[0];
  const hook = clean(caption.hook) || firstText(cover?.params?.headline, story.title);
  const body = clean(caption.body);
  const cta = clean(caption.cta);
  const tags = dest.tags ? hashtagList(caption.tags ?? [], "") : [];
  const over = hook.length > dest.captionPreview;
  const plain = [hook, body, cta, tags.join(" ")].filter(Boolean).join("\n\n");
  const section = (title, text) => (text ? `## ${title}\n\n${text}\n` : "");
  const markdown = [
    `# Caption: ${id}\n`,
    section("Hook", `${hook}\n\n${over ? `**Over the preview:** ${hook.length} characters; ${id} shows ${dest.captionPreview} before "… more". Shorten it so the hook is read whole.` : `${hook.length} of ${dest.captionPreview} characters before "… more".`}`),
    section("Body", body),
    section("Call to action", cta),
    dest.tags ? section("Tags", tags.join(" ")) : `${id} does not use tags; none are added.\n`,
    `## Ready to paste\n\n\`\`\`text\n${plain}\n\`\`\`\n`
  ].filter(Boolean).join("\n");
  return { hook, body, cta, tags, over, plain, markdown };
}

function fit(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const clean = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const firstText = (...values) => values.map(clean).find(Boolean) ?? "";

// sharp comes with hyperframes; loaded only when an image is converted.
async function sharp() {
  return (await import("sharp")).default;
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function summary(report, root) {
  const lines = [`carousel export: ${report.title ?? "untitled"} (${report.slides.length} slides) → ${path.join(root, "CAROUSEL.json")}`];
  for (const [id, dest] of Object.entries(report.destinations)) {
    lines.push(dest.status === "exported" ? `  ${id}: ${dest.files.join(", ")}` : `  ${id}: skipped, ${dest.reason}`);
    for (const problem of [...dest.errors, ...(dest.missing ?? []).map((m) => `missing ${m}`), ...dest.warnings]) lines.push(`    - ${problem}`);
  }
  return `${lines.join("\n")}\n`;
}

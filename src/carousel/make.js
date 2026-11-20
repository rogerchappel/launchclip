// launchclip carousel make "<brief>" (docs/CAROUSELS_RFC.md §11): plan the
// carousel (src/carousel/plan.js), place the user's photos or generate slide
// images (or, for a video carousel, footage clips), write the project, then run the render, check and export stages.
//
//   [--arc <id>|auto] [--dest instagram,linkedin,…] [--slides <n>]
//   [--goal save|comment|follow|visit|install] [--images <dir>] [--clips <dir>]
//   [--video] [--generate <provider>[:<model>]] [--background shared|per-slide|none]
//   [--panorama] [--variants <n>] [--out <dir>] [--json]
//   plus make's --model, --style, --seed, --keyframe-candidates, --budget,
//   --budget-daily, --max-generations.
//
// io: {stdout, stderr, cwd?, env?, client? ({client, provider, model, vision}),
// ask?, stages? ({render, check, export} run functions, for tests)}.
import { execFile } from "node:child_process";
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { CAROUSEL_ARC_IDS, CAROUSEL_BACKGROUND_MODES, CAROUSEL_DESTINATIONS, CAROUSEL_DESTINATION_IDS } from "@launchclip/core/carousel.mjs";
import { CAROUSEL_TEMPLATES, READING_LAYER } from "@launchclip/core/carousel-templates.mjs";
import { createMakeClient, selectMakeModel } from "../make/models.js";
import { makeGenerator } from "../make/generate.js";
import { styleBrand } from "../storyboard_planner.js";
import { resolveStyleV2 } from "../style_store.js";
import { generateProjectStyle, promptConstraints, promptTone } from "../style_seed_store.js";
import { PANORAMA_SRC, planCarousel } from "./plan.js";
import { slideFootage } from "./render.js";
import { probeMedia } from "../media_trim.js";

const PHOTO = /\.(jpe?g|png|webp)$/i;
const CLIP = /\.(mp4|webm|mov|m4v)$/i;
const STAGES = ["render", "check", "export"];

export async function run(brief, flags = {}, io = {}) {
  const env = io.env ?? process.env;
  const cwd = io.cwd ?? process.cwd();
  const say = (line) => { if (!flags.json) io.stderr?.write?.(`${line}\n`); };
  const arc = flags.arc == null || flags.arc === true || flags.arc === "auto" ? null : String(flags.arc);
  if (arc && !CAROUSEL_ARC_IDS.includes(arc)) throw new Error(`--arc must be auto or one of ${CAROUSEL_ARC_IDS.join(", ")}`);
  const destinations = String(flags.dest ?? "instagram").split(",").map((id) => id.trim()).filter(Boolean);
  for (const id of destinations) if (!CAROUSEL_DESTINATION_IDS.includes(id)) throw new Error(`--dest ${id} is not a destination; use ${CAROUSEL_DESTINATION_IDS.join(", ")}`);
  const slides = wholeNumber(flags.slides, "--slides");
  const background = flags.background == null || flags.background === "auto" ? null : String(flags.background);
  if (background && !CAROUSEL_BACKGROUND_MODES.includes(background)) throw new Error(`--background must be ${CAROUSEL_BACKGROUND_MODES.join(", ")} or auto; got ${flags.background}`);
  const variants = wholeNumber(flags.variants, "--variants");
  const project = path.resolve(cwd, flags.out && flags.out !== true ? String(flags.out) : slug(brief));
  await mkdir(project, { recursive: true });

  const model = io.client ?? (() => { const { spec } = selectMakeModel(flags.model, env); return createMakeClient(spec); })();
  const style = await projectStyle(project, brief, flags);
  const photos = flags.images ? await copyMedia(path.resolve(cwd, String(flags.images)), project, PHOTO, "photos") : [];
  if (flags.images && !photos.length) throw new Error(`--images ${flags.images} has no .jpg, .png or .webp files`);
  // --clips: the user's footage, each with its length so the plan keeps every card inside its clip.
  const clips = flags.clips ? await Promise.all((await copyMedia(path.resolve(cwd, String(flags.clips)), project, CLIP, "clips")).map(async (src) => ({ src, seconds: Math.floor(Number((await (io.probe ?? probeMedia)(path.join(project, src))).format?.duration) * 100) / 100 }))) : [];
  if (flags.clips && !clips.length) throw new Error(`--clips ${flags.clips} has no .mp4, .webm, .mov or .m4v files`);
  // A video carousel (RFC §5.3): --video, or footage handed in.
  const video = Boolean(flags.video) || clips.length > 0;
  say(`carousel: planning with ${model.provider} ${model.model} (PAID unless local)`);
  const planned = await planCarousel({ client: model.client, brief, arc, goal: flags.goal ?? null, destinations, slides, photos, clips, video, generate: Boolean(flags.generate), background, panorama: flags.panorama ? true : null, brand: styleBrand(style.pack), style: style.name, template: flags.template == null || flags.template === true || flags.template === "auto" ? null : String(flags.template), say });
  const { story } = planned;
  const report = { project, storyboard: "storyboard.json", video, arc: story.carousel.arc, goal: story.carousel.goal, destinations, slides: story.scenes.length, model: `${model.provider}:${model.model}`, style: style.name, plan_attempts: planned.attempts.map(({ ok, errors }) => ({ ok, errors })), images: null, variants: null, stages: {}, warnings: [...planned.warnings] };
  if (destinations.some((id) => id !== destinations[0] && CAROUSEL_DESTINATIONS[id].aspect !== CAROUSEL_DESTINATIONS[destinations[0]].aspect)) report.warnings.push(`the slides are laid out for ${destinations[0]}; destinations at another aspect are reframed by render`);

  if (flags.generate) report.images = await generateImages({ project, brief, story, plan: planned.plan, flags, variants, env, io, model, say, video });
  else if (variants > 1) report.warnings.push("--variants makes cover variants from generated images; add --generate <provider>");
  if (!flags.generate && ((background && background !== "none") || flags.panorama)) report.warnings.push("--background and --panorama are generated; add --generate <provider>");
  if (flags.panorama && video) report.warnings.push("--panorama lays a still across slides, so a video carousel leaves it out");
  if (report.images?.variants) report.variants = report.images.variants;
  // Which cards play footage and which are drawn, and how long each runs.
  if (video) report.cards = story.scenes.map((scene) => ({ id: scene.id, seconds: scene.end - scene.start, kind: slideFootage(scene) ? "footage" : "drawn", ...(slideFootage(scene) ? { source: slideFootage(scene).src } : {}), loop: scene.loop === true }));
  await writeFile(path.join(project, "storyboard.json"), `${JSON.stringify(story, null, 2)}\n`);
  say(`carousel: ${story.scenes.length}-slide ${story.carousel.arc} plan written to ${path.join(project, "storyboard.json")}`);

  for (const stage of STAGES) {
    const runStage = io.stages?.[stage] ?? (await import(`./${stage}.js`)).run;
    try {
      // Each stage prints its own report; under --json only make's goes to stdout.
      report.stages[stage] = { status: "done", report: await runStage(project, { ...flags, dest: destinations.join(",") }, flags.json ? { ...io, stdout: { write() {} } } : io) ?? null };
    } catch (error) {
      if (/is not built yet/.test(String(error?.message))) { report.stages[stage] = { status: "pending", reason: `launchclip carousel ${stage} is not built yet` }; continue; }
      report.stages[stage] = { status: "failed", error: String(error?.message ?? error) };
      report.status = "stage-failed";
      print(io, flags, report);
      throw new Error(`carousel ${stage} failed (the plan is written to ${path.join(project, "storyboard.json")}): ${String(error?.message ?? error).split("\n")[0]}`);
    }
  }
  report.status = Object.values(report.stages).some((entry) => entry.status === "pending") ? "planned" : "done";
  print(io, flags, report);
  return report;
}

function print(io, flags, report) {
  if (flags.json) { io.stdout?.write?.(`${JSON.stringify(report, null, 2)}\n`); return; }
  const lines = [`carousel: ${report.slides} slides, ${report.arc}, goal ${report.goal}, for ${report.destinations.join(", ")}`, `  plan: ${path.join(report.project, report.storyboard)}`];
  for (const [stage, entry] of Object.entries(report.stages)) lines.push(`  ${stage}: ${entry.status}${entry.reason ? ` (${entry.reason})` : ""}`);
  for (const warning of report.warnings) lines.push(`  warning: ${warning}`);
  io.stdout?.write?.(`${lines.join("\n")}\n`);
}

// --style <pack|path>, else a seeded style from the brief's tone (make's seededStyle).
async function projectStyle(project, brief, flags) {
  if (flags.style && flags.style !== true) {
    const loaded = await resolveStyleV2(String(flags.style), { projectDir: project });
    return { name: loaded.name, pack: loaded.pack };
  }
  const made = await generateProjectStyle(project, { seed: flags.seed == null ? undefined : String(flags.seed), tone: promptTone(brief), constraints: promptConstraints(brief) });
  return { name: made.name, pack: made.pack };
}

async function copyMedia(dir, project, kind, folder) {
  const files = (await readdir(dir)).filter((name) => kind.test(name)).sort();
  await mkdir(path.join(project, "assets", folder), { recursive: true });
  for (const name of files) await copyFile(path.join(dir, name), path.join(project, "assets", folder, name));
  return files.map((name) => `assets/${folder}/${name}`);
}

/**
 * --generate: each slide the plan gave an `image` is a shot request that stops
 * at the keyframe (RFC §10), through make's generator, so the quote, budget,
 * keyframe candidates and audience-led concepts all apply. The cover's
 * candidates are the --variants covers (RFC §9.3). In a video carousel the
 * request goes on past the checked keyframe to a clip of the card's length
 * (RFC §5.3), which lands at assets/generated/<slide>.mp4.
 * Generated backgrounds and the panorama (planToStory set their paths) are
 * shot requests in the same batch, so they share its concepts and quote; one
 * that is not made leaves its slides on the template's own ground.
 */
async function generateImages({ project, brief, story, plan, flags, variants, env, io, model, say, video = false }) {
  const wanted = (plan.slides ?? []).map((slide, i) => ({ slide, scene: story.scenes[i] })).filter(({ slide }) => typeof slide?.image === "string" && slide.image.trim());
  const extras = backdropJobs({ project, story, plan, video, io });
  if (!wanted.length && !extras.length) return { made: [], missing: [], note: "the plan asked for no generated images" };
  const ctxFor = (candidates) => ({ project, env, say, text: brief, format: story.format, model, adapters: { ask: io.ask }, options: { generate: flags.generate, generateImage: flags["generate-image"], generateVideo: flags["generate-video"], generateDraftVideo: flags["generate-draft-video"], keyframeCandidates: candidates, budget: flags.budget, budgetDaily: flags["budget-daily"], maxGenerations: flags["max-generations"] } });
  const request = ({ slide, scene }) => (video
    ? { id: scene.id, type: "video", shows: slide.image.trim(), format: { width: story.format.width, height: story.format.height }, duration: scene.end - scene.start }
    : { id: scene.id, type: "image", still: true, keyframeOnly: true, shows: slide.image.trim(), format: { width: story.format.width, height: story.format.height }, duration: 4 });
  const made = [];
  const missing = [];
  let coverVariants = null;
  const place = async (entry, shot) => {
    if (!shot?.file || (video && shot.kind !== "video")) { missing.push(entry.scene.id); return; }
    const target = path.join(project, "assets", "generated", `${entry.scene.id}.${video ? "mp4" : "png"}`);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(shot.file, target);
    made.push({ slide: entry.scene.id, file: path.relative(project, target), source: shot.source ?? null });
    // A generated clip is padded at both ends; the card starts past the padding.
    if (video && shot.sourceStart) {
      const { scene } = entry;
      if (scene.plate?.kind === "video") scene.plate.params.start = shot.sourceStart;
      else if (scene.params?.media && typeof scene.params.media === "object") scene.params.media.sourceStart = shot.sourceStart;
    }
  };
  const cover = variants > 1 ? wanted.find((entry) => entry.scene.slide.role === "cover") : null;
  if (cover) {
    const generator = await makeGenerator(ctxFor(variants), { brand: story.brand });
    try { await place(cover, await generator.findShot(request(cover))); } finally { await generator.close(); }
    const dir = path.join(project, "assets", "shots", "generated", cover.scene.id);
    coverVariants = (await readdir(dir).catch(() => [])).filter((name) => /-c\d+\./.test(name)).sort().map((name) => path.relative(project, path.join(dir, name)));
  }
  const rest = wanted.filter((entry) => entry !== cover);
  const backdrops = [];
  if (rest.length || extras.length) {
    const generator = await makeGenerator(ctxFor(flags["keyframe-candidates"]), { brand: story.brand });
    try {
      // Asked all at once, so the batch is quoted and art-directed together.
      const shots = rest.map((entry) => [entry, generator.findShot(request(entry))]);
      const others = extras.map((job) => [job, generator.findShot(job.request)]);
      for (const [entry, shot] of shots) await place(entry, await shot);
      for (const [job, shot] of others) backdrops.push(await job.place(await shot));
    } finally { await generator.close(); }
  }
  if (missing.length) say(`generate: no ${video ? "clip" : "image"} for ${missing.join(", ")}; those slides render once assets/generated/<slide>.${video ? "mp4" : "png"} exists`);
  const lost = backdrops.filter((entry) => !entry.file).map((entry) => entry.id);
  if (lost.length) say(`generate: no ${lost.join(", ")}; those slides keep the template's own ground`);
  return { made, missing, ...(extras.length ? { backgrounds: backdrops } : {}), ...(coverVariants ? { variants: coverVariants } : {}) };
}

const BACKGROUND_FILE = /^assets\/generated\/(?:.+-)?background\.(?:png|mp4)$/;
// shortcut: one take at the widest ratio the providers share (21:9), scaled and centre-cropped to the span, so a span
// wider than 21:9 (four 4:5 slides and up) loses height; outpaint or stitch takes if wide panoramas look cropped.
const PANORAMA_ASK = { width: 2016, ratio: 21 / 9 };

/**
 * The generated backgrounds and panorama the story asks for, each {request, place(shot) → {id, file|null}}:
 * one request per background file (shared: one for every slide on it, as long as the longest), and the panorama
 * at the widest ratio, fitted to exactly span × width by height with the template's reading layer laid in.
 */
function backdropJobs({ project, story, plan, video, io }) {
  const jobs = [];
  const { width, height } = story.format;
  const groups = new Map();
  story.scenes.forEach((scene, i) => {
    const src = scene.plate?.params?.src;
    if (BACKGROUND_FILE.test(src ?? "")) groups.set(src, [...(groups.get(src) ?? []), [scene, i]]);
  });
  for (const [src, scenes] of groups) {
    const shared = /\/background\.\w+$/.test(src);
    const own = plan.slides?.[scenes[0][1]]?.background;
    const shows = String((!shared && typeof own === "string" && own.trim()) || story.carousel.background?.shows || "").trim();
    const id = shared ? "background" : `${scenes[0][0].id}-background`;
    const seconds = Math.max(...scenes.map(([scene]) => scene.end - scene.start));
    jobs.push({
      request: video
        ? { id, type: "video", role: "background", shows, format: { width, height }, duration: seconds }
        : { id, type: "image", still: true, keyframeOnly: true, role: "background", shows, format: { width, height }, duration: 4 },
      async place(shot) {
        if (!shot?.file || (video && shot.kind !== "video")) { for (const [scene] of scenes) delete scene.plate; return { id, file: null }; }
        await mkdir(path.join(project, path.dirname(src)), { recursive: true });
        await copyFile(shot.file, path.join(project, src));
        // A generated clip is padded at both ends; the plate starts past the padding.
        if (video && shot.sourceStart) for (const [scene] of scenes) scene.plate.params.start = shot.sourceStart;
        return { id, file: src, slides: scenes.map(([scene]) => scene.id), source: shot.source ?? null };
      }
    });
  }
  const pano = story.carousel.panorama;
  if (pano) {
    const span = pano.slides[1] - pano.slides[0] + 1;
    const ratio = Math.min((span * width) / height, PANORAMA_ASK.ratio);
    const template = CAROUSEL_TEMPLATES[story.carousel.template];
    const reading = template?.reading ?? { dim: READING_LAYER, blur: 6 };
    jobs.push({
      request: { id: "panorama", type: "image", still: true, keyframeOnly: true, role: "background", shows: String(plan.panorama?.image ?? "").trim(), format: { width: PANORAMA_ASK.width, height: Math.round(PANORAMA_ASK.width / ratio / 16) * 16 }, duration: 4 },
      async place(shot) {
        if (!shot?.file) { delete story.carousel.panorama; return { id: "panorama", file: null }; }
        await mkdir(path.join(project, path.dirname(PANORAMA_SRC)), { recursive: true });
        await (io.fitPanorama ?? fitPanorama)(shot.file, path.join(project, PANORAMA_SRC), { width: span * width, height, color: story.brand?.colors?.bg ?? "#000000", dim: Number(reading.dim) || READING_LAYER, blur: Number(reading.blur) || 0 });
        return { id: "panorama", file: PANORAMA_SRC, slides: pano.slides, source: shot.source ?? null };
      }
    });
  }
  return jobs;
}

/**
 * The generated panorama as the plate the slices read: exactly width × height (scaled to cover, centre-cropped),
 * blurred and covered by the ground at `dim`, the reading layer a photo behind type gets, so every slice's type
 * reads in both renderers (the panorama draws no layer of its own).
 */
export async function fitPanorama(file, out, { width, height, color, dim, blur = 0 }) {
  const filters = [`scale=${width}:${height}:force_original_aspect_ratio=increase`, `crop=${width}:${height}`, ...(blur > 0 ? [`gblur=sigma=${blur / 2}`] : []), `drawbox=x=0:y=0:w=iw:h=ih:color=0x${color.replace("#", "")}@${dim}:t=fill`];
  await promisify(execFile)("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-vf", filters.join(","), "-frames:v", "1", out]);
}

function wholeNumber(value, flag) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a whole number from 1; got ${value}`);
  return n;
}

/** A folder name from the brief: its first words, lower case, hyphenated. */
export function slug(brief) {
  return String(brief).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).slice(0, 6).join("-") || "carousel";
}

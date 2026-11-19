// launchclip carousel make "<brief>" (docs/CAROUSELS_RFC.md §11): plan the
// carousel (src/carousel/plan.js), place the user's photos or generate slide
// images, write the project, then run the render, check and export stages.
//
//   [--arc <id>|auto] [--dest instagram,linkedin,…] [--slides <n>]
//   [--goal save|comment|follow|visit|install] [--images <dir>]
//   [--generate <provider>[:<model>]] [--variants <n>] [--out <dir>] [--json]
//   plus make's --model, --style, --seed, --keyframe-candidates, --budget,
//   --budget-daily, --max-generations.
//
// io: {stdout, stderr, cwd?, env?, client? ({client, provider, model, vision}),
// ask?, stages? ({render, check, export} run functions, for tests)}.
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CAROUSEL_ARC_IDS, CAROUSEL_DESTINATIONS, CAROUSEL_DESTINATION_IDS } from "@launchclip/core/carousel.mjs";
import { createMakeClient, selectMakeModel } from "../make/models.js";
import { makeGenerator } from "../make/generate.js";
import { styleBrand } from "../storyboard_planner.js";
import { resolveStyleV2 } from "../style_store.js";
import { generateProjectStyle, promptConstraints, promptTone } from "../style_seed_store.js";
import { planCarousel } from "./plan.js";

const PHOTO = /\.(jpe?g|png|webp)$/i;
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
  const variants = wholeNumber(flags.variants, "--variants");
  const project = path.resolve(cwd, flags.out && flags.out !== true ? String(flags.out) : slug(brief));
  await mkdir(project, { recursive: true });

  const model = io.client ?? (() => { const { spec } = selectMakeModel(flags.model, env); return createMakeClient(spec); })();
  const style = await projectStyle(project, brief, flags);
  const photos = flags.images ? await copyPhotos(path.resolve(cwd, String(flags.images)), project) : [];
  if (flags.images && !photos.length) throw new Error(`--images ${flags.images} has no .jpg, .png or .webp files`);
  say(`carousel: planning with ${model.provider} ${model.model} (PAID unless local)`);
  const planned = await planCarousel({ client: model.client, brief, arc, goal: flags.goal ?? null, destinations, slides, photos, generate: Boolean(flags.generate), brand: styleBrand(style.pack), style: style.name, say });
  const { story } = planned;
  const report = { project, storyboard: "storyboard.json", arc: story.carousel.arc, goal: story.carousel.goal, destinations, slides: story.scenes.length, model: `${model.provider}:${model.model}`, style: style.name, plan_attempts: planned.attempts.map(({ ok, errors }) => ({ ok, errors })), images: null, variants: null, stages: {}, warnings: [...planned.warnings] };
  if (destinations.some((id) => id !== destinations[0] && CAROUSEL_DESTINATIONS[id].aspect !== CAROUSEL_DESTINATIONS[destinations[0]].aspect)) report.warnings.push(`the slides are laid out for ${destinations[0]}; destinations at another aspect are reframed by render`);

  if (flags.generate) report.images = await generateImages({ project, brief, story, plan: planned.plan, flags, variants, env, io, model, say });
  else if (variants > 1) report.warnings.push("--variants makes cover variants from generated images; add --generate <provider>");
  if (report.images?.variants) report.variants = report.images.variants;
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

async function copyPhotos(dir, project) {
  const files = (await readdir(dir)).filter((name) => PHOTO.test(name)).sort();
  await mkdir(path.join(project, "assets", "photos"), { recursive: true });
  for (const name of files) await copyFile(path.join(dir, name), path.join(project, "assets", "photos", name));
  return files.map((name) => `assets/photos/${name}`);
}

/**
 * --generate: each slide the plan gave an `image` is a shot request that stops
 * at the keyframe (RFC §10), through make's generator, so the quote, budget,
 * keyframe candidates and audience-led concepts all apply. The cover's
 * candidates are the --variants covers (RFC §9.3).
 */
async function generateImages({ project, brief, story, plan, flags, variants, env, io, model, say }) {
  const wanted = (plan.slides ?? []).map((slide, i) => ({ slide, scene: story.scenes[i] })).filter(({ slide }) => typeof slide?.image === "string" && slide.image.trim());
  if (!wanted.length) return { made: [], missing: [], note: "the plan asked for no generated images" };
  const ctxFor = (candidates) => ({ project, env, say, text: brief, format: story.format, model, adapters: { ask: io.ask }, options: { generate: flags.generate, keyframeCandidates: candidates, budget: flags.budget, budgetDaily: flags["budget-daily"], maxGenerations: flags["max-generations"] } });
  const request = ({ slide, scene }) => ({ id: scene.id, type: "image", still: true, keyframeOnly: true, shows: slide.image.trim(), format: { width: story.format.width, height: story.format.height }, duration: 4 });
  const made = [];
  const missing = [];
  let coverVariants = null;
  const place = async (entry, shot) => {
    if (!shot?.file) { missing.push(entry.scene.id); return; }
    const target = path.join(project, "assets", "generated", `${entry.scene.id}.png`);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(shot.file, target);
    made.push({ slide: entry.scene.id, file: path.relative(project, target), source: shot.source ?? null });
  };
  const cover = variants > 1 ? wanted.find((entry) => entry.scene.slide.role === "cover") : null;
  if (cover) {
    const generator = await makeGenerator(ctxFor(variants), { brand: story.brand });
    try { await place(cover, await generator.findShot(request(cover))); } finally { await generator.close(); }
    const dir = path.join(project, "assets", "shots", "generated", cover.scene.id);
    coverVariants = (await readdir(dir).catch(() => [])).filter((name) => /-c\d+\./.test(name)).sort().map((name) => path.relative(project, path.join(dir, name)));
  }
  const rest = wanted.filter((entry) => entry !== cover);
  if (rest.length) {
    const generator = await makeGenerator(ctxFor(flags["keyframe-candidates"]), { brand: story.brand });
    try { for (const [entry, shot] of rest.map((entry) => [entry, generator.findShot(request(entry))])) await place(entry, await shot); } finally { await generator.close(); }
  }
  if (missing.length) say(`generate: no image for ${missing.join(", ")}; those slides render once assets/generated/<slide>.png exists`);
  return { made, missing, ...(coverVariants ? { variants: coverVariants } : {}) };
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

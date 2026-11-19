// launchclip carousel render <project> [--dest <id>[,<id>...]] [--renderer remotion|hyperframes] [--json]
// (docs/CAROUSELS_RFC.md §5.3, §5.4, §8). Each destination gets its slides'
// settled-frame stills in carousel/<dest>/NN.png (and NN.jpg where it takes
// JPG), an NN.mp4 per motion slide where it takes motion, and render.json.
// A destination whose canvas differs from the story's is reframed: the
// modules lay out again for its canvas, nothing is cropped.
import { copyFile, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { CAROUSEL_DESTINATIONS, destinationProblems, isCarousel, slideStem, slideStills } from "@launchclip/core/carousel.mjs";
import { moduleParamErrors, runStoryCommand, validateStory } from "../story_cli.js";
import { compileStoryToHyperFrames } from "../../kit/hyperframes/story-compiler.mjs";
import { getRenderer } from "../renderers/index.js";
import { captureCommand, runCommand } from "../renderers/command.js";
import { hyperframesInvocation } from "../toolchain.js";
import { hyperframesEnv } from "../renderers/hyperframes_env.js";
import { encodeRemotionDelivery, renderRemotionSegments, renderRemotionStills } from "../renderers/remotion_segments.js";
import { snapshotTime } from "../scripts/build-evidence.mjs";

const RENDERERS = new Set(["remotion", "hyperframes"]);
const SLIDE_FILE = /^\d{2,3}\.(png|jpg|mp4)$/;

export async function run(target, flags = {}, io = {}) {
  const report = await renderCarousel(target, flags, io.adapters);
  if (report.destinations.some((dest) => dest.status === "failed")) process.exitCode = 1;
  io.stdout?.write(flags.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
  return report;
}

/**
 * Renders every destination; one that fails is reported and the rest go on.
 * adapters (tests): remotion {renderer, bundleRoot, kitHash, entry, encode},
 * run (the command runner for hyperframes and ffmpeg).
 */
export async function renderCarousel(target, flags = {}, adapters = {}) {
  const input = path.resolve(String(target));
  const isFile = (await stat(input).catch(() => { throw new Error(`Cannot read carousel project: ${input}`); })).isFile();
  const project = isFile ? path.dirname(input) : input;
  const storyFile = isFile ? input : path.join(project, "storyboard.json");
  const renderer = String(flags.renderer ?? "remotion").toLowerCase();
  if (!RENDERERS.has(renderer)) throw new Error(`--renderer must be remotion or hyperframes (got ${flags.renderer})`);

  // Migrated, styled, validated and resolved the way `launchclip story resolve` does it.
  const resolved = await runStoryCommand("resolve", storyFile, {});
  const story = resolved.story_resolved;
  if (!isCarousel(story)) throw new Error(`${storyFile} is not a carousel (format.kind "carousel"); render a video with launchclip finish`);
  const ids = flags.dest && flags.dest !== true ? String(flags.dest).split(",").map((id) => id.trim()).filter(Boolean) : story.carousel?.destinations ?? ["instagram"];

  const destinations = [];
  for (const id of ids) {
    const entry = { id, status: "rendered", out: path.join(project, "carousel", id), errors: [], warnings: [...resolved.warnings] };
    destinations.push(entry);
    try {
      const framed = reframe(story, id);
      entry.reframed = framed.reframed;
      entry.errors.push(...framed.errors);
      if (!entry.errors.length) {
        const problems = destinationProblems(framed.story, id);
        entry.errors.push(...problems.errors);
        entry.warnings.push(...problems.warnings);
      }
      if (entry.errors.length) { entry.status = "failed"; continue; }
      entry.slides = await renderDestination({ story: framed.story, id, project, out: entry.out, renderer, adapters });
      await writeFile(path.join(entry.out, "render.json"), `${JSON.stringify({ destination: id, renderer, canvas: { width: framed.story.format.width, height: framed.story.format.height }, reframed: entry.reframed, slides: entry.slides, warnings: entry.warnings }, null, 2)}\n`);
    } catch (error) {
      entry.status = "failed";
      entry.errors.push(error.message);
    }
  }
  return { stage: "carousel", action: "render", renderer, project, story: storyFile, destinations };
}

/** The story laid out on a destination's canvas, re-validated there: {story, reframed, errors}. */
export function reframe(story, id) {
  const dest = CAROUSEL_DESTINATIONS[id];
  if (!dest) return { story, reframed: false, errors: destinationProblems(story, id).errors };
  const reframed = story.format.width !== dest.width || story.format.height !== dest.height;
  const framed = reframed ? { ...story, format: { ...story.format, width: dest.width, height: dest.height } } : story;
  const check = validateStory(framed);
  const errors = [...check.errors, ...(check.ok ? moduleParamErrors(framed) : [])];
  return { story: framed, reframed, errors: errors.map((message) => reframed ? `at ${dest.width}x${dest.height}: ${message}` : message) };
}

async function renderDestination({ story, id, project, out, renderer, adapters = {} }) {
  const dest = CAROUSEL_DESTINATIONS[id];
  const stills = slideStills(story);
  const fps = Number(story.format.fps) || 30;
  const scenes = new Map(story.scenes.map((scene) => [scene.id, scene]));
  const slides = stills.map((still) => {
    const stem = slideStem(still.index, stills.length);
    const scene = scenes.get(still.id);
    const motion = dest.motion && still.medium === "motion";
    return { ...still, alt: scene.slide?.alt ?? null, png: path.join(out, `${stem}.png`), jpg: dest.exports.includes("jpg") ? path.join(out, `${stem}.jpg`) : null, mp4: motion ? path.join(out, `${stem}.mp4`) : null, startFrame: Math.round(scene.start * fps), endFrame: Math.round(scene.end * fps) };
  });
  await mkdir(out, { recursive: true });
  // Slide files from an earlier render with more slides would be shipped by export.
  for (const name of await readdir(out)) if (SLIDE_FILE.test(name)) await rm(path.join(out, name), { force: true });

  if (renderer === "remotion") await remotionDestination(story, project, slides, adapters);
  else await hyperframesDestination(story, project, slides, fps, adapters);

  const { default: sharp } = await import("sharp");
  for (const slide of slides) if (slide.jpg) await sharp(slide.png).flatten({ background: "#ffffff" }).jpeg({ quality: 92, mozjpeg: true }).toFile(slide.jpg);
  return slides.map((slide) => ({
    id: slide.id, index: slide.index, role: slide.role, medium: slide.medium, at: slide.at, frame: slide.frame, alt: slide.alt,
    files: [slide.png, slide.jpg, slide.mp4].filter(Boolean).map((file) => path.relative(out, file)),
    ...(slide.mp4 ? { clip: { start_frame: slide.startFrame, end_frame: slide.endFrame } } : {})
  }));
}

// One bundle for every destination (its key ignores the props) and one browser for the stills.
async function remotionDestination(story, project, slides, { remotion = {} } = {}) {
  const entry = remotion.entry ?? getRenderer("remotion").resolveEntry(project, {});
  const kitHash = remotion.kitHash ?? await (await import("../render_segments.js")).kitFingerprint("remotion", { project });
  const common = { entry, project, props: story, kitHash, bundleRoot: remotion.bundleRoot, renderer: remotion.renderer ?? null };
  await renderRemotionStills({ ...common, stills: slides.map((slide) => ({ frame: slide.frame, output: slide.png })) });
  const clips = slides.filter((slide) => slide.mp4);
  if (!clips.length) return;
  // shortcut: the clips open a second browser (renderRemotionSegments opens its own); share one if motion-heavy carousels get slow.
  await renderRemotionSegments({ ...common, concurrency: 2, segments: clips.map((slide) => ({ startFrame: slide.startFrame, endFrame: slide.endFrame, output: `${slide.mp4}.mezzanine.mp4` })) });
  const encode = remotion.encode ?? encodeRemotionDelivery;
  for (const slide of clips) {
    await encode(`${slide.mp4}.mezzanine.mp4`, slide.mp4, { quality: "high" });
    await rm(`${slide.mp4}.mezzanine.mp4`, { force: true });
  }
}

async function hyperframesDestination(story, project, slides, fps, { run = runCommand } = {}) {
  await mkdir(path.join(project, ".launchclip"), { recursive: true });
  const work = await mkdtemp(path.join(project, ".launchclip", "carousel-hf-"));
  try {
    const compiled = path.join(work, "project");
    await compileStoryToHyperFrames(story, { projectDir: compiled, sourceDir: project });
    const hf = async (args, label) => {
      const invocation = hyperframesInvocation(args);
      const result = await captureCommand(run, invocation.command, invocation.args, { cwd: compiled, env: hyperframesEnv() });
      if (!result.ok) throw new Error(`HyperFrames ${label} failed (exit ${result.exit_code}): ${String(result.stderr).trim().split("\n").slice(-6).join("\n")}`);
    };
    // One snapshot call: one browser for every still. Files come back in request order.
    const frames = path.join(work, "frames");
    await hf(["snapshot", "--at", slides.map((slide) => snapshotTime(slide.frame, fps)).join(","), "--no-end", "--output", frames, "--describe", "false", compiled], "snapshot");
    const files = (await readdir(frames)).filter((name) => /^frame-\d+.*\.png$/i.test(name)).sort();
    if (files.length < slides.length) throw new Error(`HyperFrames snapshot wrote ${files.length} frames for ${slides.length} slides`);
    for (const [i, slide] of slides.entries()) await copyFile(path.join(frames, files[i]), slide.png);
    const clips = slides.filter((slide) => slide.mp4);
    if (!clips.length) return;
    // shortcut: hyperframes render has no frame range, so the whole story renders once and each clip is cut from it; render per scene if carousels grow long.
    const full = path.join(work, "full.mp4");
    await hf(["render", "--output", full, "--quality", "high", "--workers", "2", compiled], "render");
    for (const slide of clips) {
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", full, "-vf", `trim=start_frame=${slide.startFrame}:end_frame=${slide.endFrame},setpts=PTS-STARTPTS`, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", slide.mp4]);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export function formatReport(report) {
  const lines = [`carousel render (${report.renderer}): ${report.project}`];
  for (const dest of report.destinations) {
    const files = (dest.slides ?? []).flatMap((slide) => slide.files).length;
    lines.push(dest.status === "failed"
      ? `  ${dest.id}: failed`
      : `  ${dest.id}: ${dest.slides.length} slides, ${files} files in ${path.relative(report.project, dest.out) || "."}${dest.reframed ? " (reframed)" : ""}`);
    for (const error of dest.errors) lines.push(`    error: ${error}`);
    for (const warning of dest.warnings) lines.push(`    warning: ${warning}`);
  }
  return `${lines.join("\n")}\n`;
}

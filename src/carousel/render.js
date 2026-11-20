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
import { encodeRemotionDelivery, remotionBrowserExecutable, renderRemotionSegments, renderRemotionStills } from "../renderers/remotion_segments.js";
import { snapshotTime } from "../scripts/build-evidence.mjs";
import { probeMedia } from "../media_trim.js";

const RENDERERS = new Set(["remotion", "hyperframes"]);
const SLIDE_FILE = /^\d{2,3}\.(png|jpg|mp4)$/;
const VIDEO = /\.(mp4|webm|mov|m4v)$/i;

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
  // A footage card plays its source from a start; a source that ends first would leave the card's tail empty.
  const footage = await footageProblems(story, project, adapters.probe);
  const ids = flags.dest && flags.dest !== true ? String(flags.dest).split(",").map((id) => id.trim()).filter(Boolean) : story.carousel?.destinations ?? ["instagram"];

  const destinations = [];
  for (const id of ids) {
    const entry = { id, status: "rendered", out: path.join(project, "carousel", id), errors: [], warnings: [...resolved.warnings] };
    destinations.push(entry);
    try {
      const framed = reframe(story, id);
      entry.reframed = framed.reframed;
      entry.errors.push(...framed.errors, ...footage);
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

/**
 * A motion slide's footage, when it has one: a video plate under its type
 * ({src, start}) or a footage module's video (params.media, from sourceStart).
 * → {src, start} | null
 */
export function slideFootage(scene) {
  const plate = scene?.plate;
  if (plate?.kind === "video" && typeof plate.params?.src === "string") return { src: plate.params.src, start: Number(plate.params.start ?? 0) || 0 };
  const media = scene?.params?.media;
  const src = typeof media === "string" ? media : media?.src;
  return typeof src === "string" && VIDEO.test(src) ? { src, start: Number(media?.sourceStart ?? 0) || 0 } : null;
}

/** "slide <id>: …" for each motion slide whose footage is missing or ends before the card does. probe (tests): file → ffprobe JSON. */
export async function footageProblems(story, project, probe = probeMedia) {
  const problems = [];
  for (const scene of story.scenes.filter((entry) => entry.slide?.medium === "motion")) {
    const footage = slideFootage(scene);
    if (!footage) continue;
    const length = scene.end - scene.start;
    let duration;
    try { duration = Number((await probe(path.join(project, footage.src))).format?.duration); } catch { problems.push(`slide ${scene.id}: cannot read its footage ${footage.src}`); continue; }
    if (Number.isFinite(duration) && footage.start + length > duration + 1 / 30) problems.push(`slide ${scene.id}: its footage ${footage.src} runs ${duration.toFixed(2)} s, so from ${footage.start} s it cannot fill the ${length} s card; start earlier or shorten the card`);
  }
  return problems;
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

/**
 * A motion slide as a video story of its own: its scene alone, from 0. With
 * loop: true it loops onto itself (ending.loop_to): layers on story time (the
 * ambient blobs, a background's drift) then fit whole cycles into the clip, so
 * its last frame leads into its first (kit/core/story-loop.mjs). Without it
 * the clip plays once and holds (ending.final "hold": the exit falls past the
 * last frame, so that frame is settled). Its clip is the whole story.
 */
export function motionStory(story, id) {
  const scene = story.scenes.find((entry) => entry.id === id);
  const length = scene.end - scene.start;
  const fps = Number(story.format.fps) || 30;
  const { kind: _kind, ...format } = story.format;
  const { carousel: _carousel, ...rest } = story;
  // Other tracks over the slide (an overlay) come along, shifted with it. No
  // slide fields: one scene is not a carousel, and nothing renders them.
  const scenes = story.scenes.filter((entry) => entry.start >= scene.start && entry.end <= scene.end).map(({ slide: _slide, ...entry }) => ({ ...entry, start: entry.start - scene.start, end: entry.end - scene.start }));
  // A typed in: a plate at frame 0 with none enters fully visible (kit/core/modules.mjs
  // openingSettled), skipping its entrance, and a loop's seam would blink.
  scenes[scenes.findIndex((entry) => entry.id === id)].in = scene.in ?? { type: "cut", dur: Math.round(1e4 / fps) / 1e4 };
  return {
    ...rest,
    format: { ...format, duration: length },
    ...(story.resolved ? { resolved: { ...story.resolved, duration: length, frames: Math.round(length * fps) } } : {}),
    scenes,
    ending: scene.loop === true ? { loop_to: id } : { final: "hold" }
  };
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
    return { ...still, story: still.medium === "motion" ? motionStory(story, still.id) : null, alt: scene.slide?.alt ?? null, png: path.join(out, `${stem}.png`), jpg: dest.exports.includes("jpg") ? path.join(out, `${stem}.jpg`) : null, mp4: motion ? path.join(out, `${stem}.mp4`) : null, startFrame: Math.round(scene.start * fps), endFrame: Math.round(scene.end * fps) };
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

// One bundle for every destination (its key ignores the props) and one browser
// for every still and clip. A motion slide's still and clip come from its own
// story (motionStory), so the still is a frame of the clip.
async function remotionDestination(story, project, slides, { remotion = {} } = {}) {
  const entry = remotion.entry ?? getRenderer("remotion").resolveEntry(project, {});
  const kitHash = remotion.kitHash ?? await (await import("../render_segments.js")).kitFingerprint("remotion", { project });
  const { openBrowser } = remotion.renderer ?? await import("@remotion/renderer");
  const browser = await openBrowser("chrome", { logLevel: "error", browserExecutable: remotionBrowserExecutable() });
  const common = { entry, project, kitHash, bundleRoot: remotion.bundleRoot, renderer: remotion.renderer ?? null, browser };
  const encode = remotion.encode ?? encodeRemotionDelivery;
  try {
    await renderRemotionStills({ ...common, props: story, stills: slides.filter((slide) => !slide.story).map((slide) => ({ frame: slide.frame, output: slide.png })) });
    for (const slide of slides.filter((slide) => slide.story)) {
      await renderRemotionStills({ ...common, props: slide.story, stills: [{ frame: slide.frame - slide.startFrame, output: slide.png }] });
      if (!slide.mp4) continue;
      await renderRemotionSegments({ ...common, props: slide.story, concurrency: 2, segments: [{ startFrame: 0, endFrame: slide.endFrame - slide.startFrame, output: `${slide.mp4}.mezzanine.mp4` }] });
      await encode(`${slide.mp4}.mezzanine.mp4`, slide.mp4, { quality: "high" });
      await rm(`${slide.mp4}.mezzanine.mp4`, { force: true });
    }
  } finally {
    await browser.close({ silent: true }).catch(() => {});
  }
}

// One snapshot call for the still slides: one browser for every still, files
// back in request order. Each motion slide compiles its own story
// (motionStory) and renders it whole: hyperframes render has no frame range,
// and the whole of that story is exactly the clip, so nothing is trimmed.
async function hyperframesDestination(story, project, slides, fps, { run = runCommand } = {}) {
  await mkdir(path.join(project, ".launchclip"), { recursive: true });
  const work = await mkdtemp(path.join(project, ".launchclip", "carousel-hf-"));
  try {
    let n = 0;
    const compile = async (props) => {
      const dir = path.join(work, `project-${n++}`);
      await compileStoryToHyperFrames(props, { projectDir: dir, sourceDir: project });
      return dir;
    };
    const hf = async (compiled, args, label) => {
      const invocation = hyperframesInvocation([...args, compiled]);
      const result = await captureCommand(run, invocation.command, invocation.args, { cwd: compiled, env: hyperframesEnv() });
      if (!result.ok) throw new Error(`HyperFrames ${label} failed (exit ${result.exit_code}): ${String(result.stderr).trim().split("\n").slice(-6).join("\n")}`);
    };
    const snapshot = async (compiled, shots) => {
      const frames = path.join(work, `frames-${n++}`);
      await hf(compiled, ["snapshot", "--at", shots.map((shot) => snapshotTime(shot.frame, fps)).join(","), "--no-end", "--output", frames, "--describe", "false"], "snapshot");
      const files = (await readdir(frames)).filter((name) => /^frame-\d+.*\.png$/i.test(name)).sort();
      if (files.length < shots.length) throw new Error(`HyperFrames snapshot wrote ${files.length} frames for ${shots.length} slides`);
      for (const [i, shot] of shots.entries()) await copyFile(path.join(frames, files[i]), shot.output);
    };
    const flat = slides.filter((slide) => !slide.story);
    if (flat.length) await snapshot(await compile(story), flat.map((slide) => ({ frame: slide.frame, output: slide.png })));
    for (const slide of slides.filter((slide) => slide.story)) {
      const compiled = await compile(slide.story);
      await snapshot(compiled, [{ frame: slide.frame - slide.startFrame, output: slide.png }]);
      if (!slide.mp4) continue;
      const full = path.join(work, `clip-${n++}.mp4`);
      await hf(compiled, ["render", "--output", full, "--quality", "high", "--workers", "2"], "render");
      // Silent: the video stream only, as rendered.
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", full, "-map", "0:v:0", "-an", "-c:v", "copy", "-movflags", "+faststart", slide.mp4]);
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

// launchclip reel <project> [--out <dir>] [--at <s>] [--hook "…"] [--payoff "…"] [--bpm 120] [--force]
// launchclip reel check <video> [--min-ssim 0.99]
//
// The breakdown reel (docs/ROADMAP.md): a 10 s "how it was made" loop built
// from a finished project's own artefacts. It writes a new project (one
// layer-stack scene, kit/core/catalog-i-layers.mjs) that `launchclip finish`
// renders with either renderer:
//   an animation project (BIBLE.json): the bible's reference sheet, the
//     animatic frame and the final;
//   any other project: the storyboard, the style, the hero scene's module
//     drawn plain (no brand colour, no look) and the final.
// The final is renders/final.mp4 (else renders/draft.mp4): its frame at the
// hero time is the reel's first and last frame, and the 1.5 s before it play
// over beats 3–6. A layer the project does not have is left out and named in
// REEL.json.
//
// `reel check` is the loop-seam check: the first and last frames of a render
// must match (SSIM and PSNR, within encoder noise), so the reel loops
// without a visible cut.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { reelBeats } from "@launchclip/core/catalog-i-layers.mjs";
import { MODULES } from "@launchclip/core/catalog-h.mjs";
import { BIBLE_FILE } from "@launchclip/core/bible.mjs";
import { resolveStory } from "@launchclip/core/story.mjs";
import { compileStoryCommand } from "./story_cli.js";
import { hyperframesInvocation } from "./toolchain.js";
import { hyperframesEnv } from "./renderers/hyperframes_env.js";

const execFileAsync = promisify(execFile);
export const REEL_SCHEMA = "launchclip.reel.v1";
export const REEL_HOOK = "How this shot was made";
export const REEL_PAYOFF = "One project. Every layer.";
const FINALS = ["renders/final.mp4", "renders/draft.mp4"];
const ANIMATIC = "renders/animatic.mp4";
const PLAIN_BRAND = { bg: "#1b1c20", primary: "#8f949c", accent: "#c3c7ce", ink: "#1b1c20", paper: "#e8e9eb" };

const ff = (args) => execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { maxBuffer: 1 << 26 });
async function duration(file) {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(stdout.trim());
}
const still = (video, t, out) => ff(["-ss", String(t), "-i", video, "-frames:v", "1", "-q:v", "2", out]);

/** The scene the hero frame sits in, and the hero time: --at, else three quarters into the scene at the middle of the video. */
export function heroOf(scenes, length, at) {
  const play = 3 * reelBeats().beat;
  if (at !== undefined) {
    const t = Number(at);
    if (!(t >= play && t <= length)) throw new Error(`--at must be ${play}–${length} s into the final (the ${play} s before it play in the reel)`);
    return { t, scene: scenes.find((s) => t >= s.start && t < s.end) ?? scenes.at(-1) };
  }
  const mid = length / 2;
  const scene = scenes.find((s) => mid >= s.start && mid < s.end) ?? scenes.at(-1);
  return { t: Math.min(length - 0.05, Math.max(play, scene.start + 0.75 * (scene.end - scene.start))), scene };
}

/** Up to six storyboard panels from the scenes, spread across the video. */
export function storyboardPanels(scenes) {
  const pick = scenes.length <= 6 ? scenes : Array.from({ length: 6 }, (_, i) => scenes[Math.round(i * (scenes.length - 1) / 5)]);
  const caption = (s) => {
    const p = s.params ?? {};
    const text = [p.title, p.name, p.headline, p.text, p.quote].find((v) => typeof v === "string" && v.trim()) ?? s.module;
    return text.length > 40 ? `${text.slice(0, 39).trimEnd()}…` : text;
  };
  return pick.map(caption);
}

// The hero scene alone, in plain greys with no look or backdrop, snapped at the hero instant with HyperFrames.
async function plainStill(resolved, scene, at, project, out) {
  const work = await mkdtemp(path.join(os.tmpdir(), "launchclip-reel-plain-"));
  try {
    // The scene keeps its own clock (its hits are absolute), on a story that ends with it.
    const story = { schema: resolved.schema, title: "plain", lane: "motion", format: { ...resolved.format, duration: scene.end }, brand: { ...resolved.brand, colors: PLAIN_BRAND },
      base: null, scenes: [{ ...scene, in: undefined, out: undefined }], overlays: [{ type: "captions", style: "none" }] };
    await writeFile(path.join(work, "storyboard.json"), `${JSON.stringify(story, null, 2)}\n`);
    if (existsSync(path.join(project, "assets"))) await symlink(path.join(project, "assets"), path.join(work, "assets"));
    const compiled = await compileStoryCommand(work, { renderer: "hyperframes", out: path.join(work, "hf") });
    const frames = path.join(work, "frames");
    const run = hyperframesInvocation(["snapshot", "--at", String(Math.min(scene.end - 0.1, at)), "--no-end", "--output", frames, "--describe", "false", compiled.out]);
    await execFileAsync(run.command, run.args, { cwd: compiled.out, env: hyperframesEnv(), maxBuffer: 1 << 26 });
    const file = (await readdir(frames)).find((name) => /^frame-\d+.*\.(png|jpe?g)$/i.test(name));
    if (!file) throw new Error("hyperframes snapshot wrote no frame");
    await ff(["-i", path.join(frames, file), "-q:v", "2", out]);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function runReel(projectPath, flags = {}, hooks = {}) {
  const project = path.resolve(String(projectPath ?? "."));
  const storyFile = path.join(project, "storyboard.json");
  if (!existsSync(storyFile)) throw new Error(`launchclip reel needs ${storyFile}`);
  const story = JSON.parse(await readFile(storyFile, "utf8"));
  const finalRel = FINALS.find((rel) => existsSync(path.join(project, rel)));
  if (!finalRel) throw new Error(`launchclip reel breaks down a finished project: render it first (launchclip finish ${projectPath}); looked for ${FINALS.join(", ")}`);
  const final = path.join(project, finalRel);
  const out = path.resolve(String(flags.out ?? path.join(project, "reel")));
  if (existsSync(path.join(out, "storyboard.json")) && !flags.force) throw new Error(`${out} already has a reel; pass --force to write it again`);
  const bpm = flags.bpm === undefined ? 120 : Number(flags.bpm);
  const beats = reelBeats(bpm);
  const words = await readWords(project, story);
  const resolved = resolveStory(story, { words });
  const length = await duration(final);
  const hero = heroOf(resolved.scenes, length, flags.at);

  await mkdir(path.join(out, "assets", "layers"), { recursive: true });
  await rm(path.join(out, "assets", "play"), { recursive: true, force: true });
  await mkdir(path.join(out, "assets", "play"), { recursive: true });
  const layers = [], skipped = [], sources = {};
  const animation = existsSync(path.join(project, BIBLE_FILE));
  if (animation) {
    const bible = JSON.parse(await readFile(path.join(project, BIBLE_FILE), "utf8"));
    // The cast is a list, or {characters: [...]} (src/bible.js); each entry names its reference sheet.
    const cast = Array.isArray(bible.cast) ? bible.cast : Array.isArray(bible.cast?.characters) ? bible.cast.characters : [];
    const sheet = cast.map((c) => c?.sheet).find((rel) => typeof rel === "string" && existsSync(path.join(project, rel)));
    if (sheet) {
      await copyFile(path.join(project, sheet), path.join(out, "assets", "layers", `bible${path.extname(sheet)}`));
      layers.push({ label: "Bible", image: `assets/layers/bible${path.extname(sheet)}`, fit: "contain" });
      sources.bible = sheet;
    } else skipped.push({ layer: "bible", reason: "BIBLE.json has no reference sheet on disk" });
    if (existsSync(path.join(project, ANIMATIC))) {
      await still(path.join(project, ANIMATIC), Math.min(hero.t, (await duration(path.join(project, ANIMATIC))) - 0.05), path.join(out, "assets", "layers", "animatic.jpg"));
      layers.push({ label: "Animatic", image: "assets/layers/animatic.jpg" });
      sources.animatic = ANIMATIC;
    } else skipped.push({ layer: "animatic", reason: `no ${ANIMATIC}` });
  } else {
    layers.push({ label: "Storyboard", kind: "storyboard", panels: storyboardPanels(resolved.scenes) });
    sources.storyboard = "storyboard.json";
    layers.push({ label: "Style", kind: "style" });
    sources.style = "storyboard.json brand";
    try {
      await (hooks.plainStill ?? plainStill)(resolved, hero.scene, hero.t, project, path.join(out, "assets", "layers", "plain.jpg"));
      layers.push({ label: "Plain module", image: "assets/layers/plain.jpg" });
      sources.plain = `scene ${hero.scene.id} (${hero.scene.module}) in plain greys`;
    } catch (error) {
      skipped.push({ layer: "plain module", reason: error.message.split("\n")[0] });
    }
  }
  await still(final, hero.t, path.join(out, "assets", "layers", "final.jpg"));
  layers.push({ label: "Final", image: "assets/layers/final.jpg" });
  sources.final = `${finalRel} at ${Math.round(hero.t * 1000) / 1000} s`;
  if (layers.length < 2) throw new Error(`a breakdown needs at least two layers; this project has only the final (${skipped.map((s) => s.reason).join("; ")})`);

  // The 3 beats before the hero frame, at the frame rate (48 frames at most).
  const playLength = beats.tilt - beats.play, fps = Math.min(story.format?.fps ?? 30, Math.floor(48 / playLength));
  await ff(["-ss", String(Math.max(0, hero.t - playLength)), "-t", String(playLength), "-i", final, "-vf", `fps=${fps}`, "-q:v", "3", path.join(out, "assets", "play", "f%02d.jpg")]);
  const play = (await readdir(path.join(out, "assets", "play"))).filter((f) => f.endsWith(".jpg")).sort().slice(0, 48).map((f) => `assets/play/${f}`);

  const reel = {
    schema: "launchclip.story.v1",
    title: `Breakdown: ${story.title ?? path.basename(project)}`,
    lane: "motion",
    format: { width: story.format.width, height: story.format.height, fps: story.format.fps ?? 30, duration: beats.end, platform: story.format.height > story.format.width ? "youtube-shorts" : "youtube" },
    brand: story.brand,
    base: null,
    audio: { music: { provider: "synth", bpm } },
    scenes: [{ id: "reel", module: "layer-stack", start: 0, end: beats.end, params: { hook: String(flags.hook ?? REEL_HOOK), payoff: String(flags.payoff ?? REEL_PAYOFF), bpm, layers, ...(play.length >= 2 ? { play } : {}) } }],
    overlays: [{ type: "captions", style: "none" }],
    // The scene ends on its own first frame; a loop_to ending would lay a transition over that.
    ending: { loop: false, final: "exit" }
  };
  // Fail here, not as a placeholder in the render: the scene must resolve (label widths, hook length, timing).
  const scene = reel.scenes[0];
  MODULES["layer-stack"].resolve(scene.params, { id: scene.id, start: 0, duration: beats.end, format: reel.format, brand: reel.brand, hits: [] });
  await writeFile(path.join(out, "storyboard.json"), `${JSON.stringify(reel, null, 2)}\n`);
  const receipt = { schema: REEL_SCHEMA, project, kind: animation ? "animation" : "explainer", final: finalRel, hero: { at: hero.t, scene: hero.scene.id }, bpm, layers: layers.map((l) => l.label), sources, skipped };
  await writeFile(path.join(out, "REEL.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  return { stage: "reel", status: "ready", out, ...receipt, next: `launchclip finish ${out} --renderer remotion|hyperframes, then launchclip reel check <render> for the loop seam` };
}

async function readWords(project, story) {
  const rel = typeof story.audio?.words === "string" ? story.audio.words : existsSync(path.join(project, "NARRATION.json")) ? "NARRATION.json" : null;
  if (!rel || !existsSync(path.join(project, rel))) return [];
  const doc = JSON.parse(await readFile(path.join(project, rel), "utf8"));
  return Array.isArray(doc) ? doc : doc.words ?? [];
}

// The seam is judged against encoder noise, not bit-exactness: frame 0 is a
// keyframe and the last a predicted frame, so a perfect loop in a draft encode
// measures about SSIM 0.98 / 38 dB, while a visible jump (a drift or a
// transition left over the last frames) measures 0.80–0.86. One frame of the
// reel's own motion is about 0.977.
export const SEAM = Object.freeze({ ssim: 0.97, psnr: 35 });

/** The loop seam: SSIM and PSNR between a render's first and last frames. */
export async function loopSeam(video, { minSsim = SEAM.ssim, minPsnr = SEAM.psnr } = {}) {
  const file = path.resolve(String(video));
  if (!existsSync(file)) throw new Error(`no video at ${file}`);
  const work = await mkdtemp(path.join(os.tmpdir(), "launchclip-reel-seam-"));
  try {
    const first = path.join(work, "first.png"), last = path.join(work, "last.png");
    await ff(["-i", file, "-frames:v", "1", first]);
    await ff(["-sseof", "-0.5", "-i", file, "-update", "1", last]);
    const { stderr } = await execFileAsync("ffmpeg", ["-hide_banner", "-i", first, "-i", last, "-lavfi", "[0][1]ssim;[0][1]psnr", "-f", "null", "-"]);
    const ssim = Number(/All:([\d.]+)/.exec(stderr)?.[1]), psnrText = /average:([\d.]+|inf)/.exec(stderr)?.[1];
    const psnr = psnrText === "inf" ? Infinity : Number(psnrText);
    if (!Number.isFinite(ssim) || Number.isNaN(psnr)) throw new Error("ffmpeg reported no SSIM or PSNR");
    return { stage: "reel", action: "check", video: file, ssim, psnr, min_ssim: minSsim, min_psnr: minPsnr, status: ssim >= minSsim && psnr >= minPsnr ? "passed" : "failed" };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function runReelCommand(target, rest = [], flags = {}) {
  if (target === "check") {
    const video = rest.find((arg) => !arg.startsWith("--"));
    if (!video) throw new Error("usage: launchclip reel check <video> [--min-ssim 0.97]");
    const report = await loopSeam(video, { minSsim: flags["min-ssim"] === undefined ? SEAM.ssim : Number(flags["min-ssim"]) });
    if (report.status === "failed") throw new Error(`the loop seam shows: first and last frames have SSIM ${report.ssim.toFixed(4)} and PSNR ${report.psnr.toFixed(1)} dB (needs ${report.min_ssim} and ${report.min_psnr} dB)`);
    return report;
  }
  if (!target) throw new Error("usage: launchclip reel <project> [--out dir] [--at s] [--hook \"…\"] [--payoff \"…\"] [--bpm 120] [--force]");
  return runReel(target, flags);
}

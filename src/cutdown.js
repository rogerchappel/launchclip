// launchclip cutdown <project> --to shorts [--section <id> | --lines 23-28 | --range 120-150] [--out dir] [--max 58] [--model provider:model] [--force]
//
// A Short from one section of a long video (docs/VIDEO_QUALITY_RFC.md §10.2):
// a new 9:16 project that re-plans the section against the Shorts profile
// instead of cropping the long form (kit/core/cutdown.mjs). It reuses the long
// form's base edit (as base.trim), mattes and face track (the project's
// assets, linked), maps the scenes' word anchors into the section's time
// range, opens on a hook card and loops back to it.
//
// Without --model the re-plan is deterministic and free. With --model the
// planner (src/storyboard_planner.js) plans the Short from the section's words
// against the Shorts profile (paid calls), and the cut keeps the base edit,
// the hook check and the loop ending.
//
// A voiceover-motion story (no recording) is cut too: its narration is
// spliced from the picked lines into the Short's own assets/audio, and its
// shots, beats and captions re-timed onto the Short's clock
// (cutdownMotionStory). --lines and --range pick the narration by hand,
// several stretches at once ("64,71-74,78").
//
// Writes <out>/storyboard.json, DIRECTION.json, NARRATION.json, CUTDOWN.json
// (the receipt) and assets/ (hard links to the long form's assets, without its
// audio and captions, which finish makes again for the Short).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, link, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { CUTDOWN_SCHEMA, CUTDOWN_TARGETS, CUTDOWN_VOICE, chooseCutWindow, cutdownMotionStory, cutdownStory, pickCutWindow } from "@launchclip/core/cutdown.mjs";
import { directionJson } from "@launchclip/core/direction.mjs";
import { resolveStory, validateStory } from "@launchclip/core/story.mjs";
import { storyStyleRequest } from "@launchclip/core/style.mjs";
import { resolveProfile } from "./profile_store.js";
import { coverageGate } from "./quality_gates.js";
import { checkStoryboard, createPlannerClient, planStoryboard } from "./storyboard_planner.js";
import { directionFileFor } from "./story_cli.js";
import { readStoryEdl } from "./story_loader.js";
import { readStorySubject, readStoryTrack } from "./subject/project.js";
import { resolveStyleV2 } from "./style_store.js";

const execFileAsync = promisify(execFile);
// Lanes cutdown cuts: a presenter's recording, or narration over motion graphics.
const LANES = new Set(["footage-led", "voiceover-motion"]);
// Long-form assets the Short makes again for itself.
const OWN_ASSETS = new Set(["audio", "captions"]);

export async function runCutdown(projectPath, flags = {}, adapters = {}) {
  const project = path.resolve(String(projectPath ?? "."));
  const to = String(flags.to ?? "").toLowerCase();
  const target = CUTDOWN_TARGETS[to];
  if (!target) throw new Error(`cutdown needs --to ${Object.keys(CUTDOWN_TARGETS).join(" | ")}`);
  const storyFile = path.join(project, "storyboard.json");
  if (!existsSync(storyFile)) throw new Error(`launchclip cutdown needs ${storyFile}`);
  const story = JSON.parse(await readFile(storyFile, "utf8"));
  if (!LANES.has(story.lane)) throw new Error(`cutdown cuts footage-led and voiceover-motion videos; this story is ${story.lane}`);
  const motion = story.lane === "voiceover-motion";
  if (motion && typeof story.audio?.voice !== "string") throw new Error("cutdown splices the Short's narration from audio.voice; this story has none (run launchclip voice first)");
  if (motion && flags.model) throw new Error("--model re-plans footage-led cut-downs only; a voiceover-motion Short reuses the long form's shots");
  const mapFile = directionFileFor(storyFile);
  if (!existsSync(mapFile)) throw new Error(`cutdown picks the section from ${path.basename(mapFile)}; write the direction map first`);
  const map = JSON.parse(await readFile(mapFile, "utf8"));
  const wordsFile = typeof story.audio?.words === "string" ? path.resolve(project, story.audio.words) : null;
  if (!wordsFile || !existsSync(wordsFile)) throw new Error("cutdown maps the narration words into the section; the story has no audio.words file");
  const wordsDoc = JSON.parse(await readFile(wordsFile, "utf8"));
  const words = Array.isArray(wordsDoc) ? wordsDoc : wordsDoc.words ?? [];
  const resolved = resolveStory(story, { words, edl: await readStoryEdl(project, story), subject: await readStorySubject(project, story), track: await readStoryTrack(project, story) });

  const max = flags.max !== undefined ? Number(flags.max) : target.max;
  if (!(max >= target.min && max <= 60)) throw new Error(`--max must be ${target.min}–60 seconds`);
  const picked = flags.lines !== undefined || flags.range !== undefined;
  if (picked && flags.section) throw new Error("pass --section, --lines or --range, not several");
  if (flags.lines !== undefined && flags.range !== undefined) throw new Error("pass --lines or --range, not both");
  const window = picked
    ? pickCutWindow(map, words, flags.lines !== undefined ? { lines: String(flags.lines) } : { range: String(flags.range) })
    : chooseCutWindow(map, words, { section: flags.section ? String(flags.section) : null, max, min: target.min });
  if (!motion && window.segments.length > 1) throw new Error("a footage-led Short is one stretch of the recording; pick consecutive lines");
  const { profile } = resolveProfile(motion ? target.motionProfile : target.profile);
  const cut = motion ? cutdownMotionStory(resolved, { story, words, window, profile, target }) : cutdownStory(resolved, { story, words, window, profile, target });
  const length = cut.story.format.duration;
  if (picked && length > 60) throw new Error(`the picked narration runs ${length} s; a Short is 60 s at most`);
  if (picked && length < target.min) cut.warnings.push(`the picked narration runs ${length} s, under the ${target.min} s a Short usually needs`);
  const name = picked ? `${window.section}-${flags.lines !== undefined ? `l${String(flags.lines)}` : `t${String(flags.range)}`}` : window.section;
  const out = path.resolve(flags.out ? String(flags.out) : path.join(project, "cutdowns", `${slugName(name)}-${to}`));
  if (motion) cut.story.style = rebaseStyle(cut.story.style, project, out);
  if (existsSync(path.join(out, "storyboard.json")) && !flags.force) throw new Error(`${out} already holds a storyboard; pass --force to replace it`);

  // --model: the planner re-plans the section's words against the Shorts profile.
  let plan = null;
  let planned = cut.story;
  let map2 = cut.map;
  const warnings = [...cut.warnings];
  const pack = await stylePack(story, project);
  if (flags.model) {
    const client = adapters.client ?? createPlannerClient(String(flags.model));
    plan = await planStoryboard({
      brief: shortBrief(story, window, cut),
      words: cut.words,
      lane: "footage-led",
      format: cut.story.format,
      brand: story.brand,
      tier: "guided",
      model: String(flags.model),
      client,
      audio: { words: "NARRATION.json" },
      base: cut.story.base.src,
      style: pack,
      direction: true,
      profile,
      longForm: false
    });
    if (plan.status !== "passed") throw new Error(`the planner's Short failed its checks:\n- ${plan.errors.slice(0, 8).join("\n- ")}`);
    planned = { ...plan.storyboard, base: cut.story.base, ending: plan.storyboard.ending?.loop_to ? plan.storyboard.ending : { loop_to: plan.storyboard.scenes[0]?.id } };
    map2 = plan.direction ?? cut.map;
    warnings.push(...plan.warnings);
  }

  const shape = validateStory(planned);
  if (!shape.ok) throw new Error(`the Short is invalid:\n- ${shape.errors.join("\n- ")}`);
  const check = checkStoryboard(planned, { words: cut.words, direction: map2, tier: "guided", style: pack, profile, bandErrors: false });
  if (!check.ok) throw new Error(`the Short failed its checks:\n- ${check.errors.slice(0, 10).join("\n- ")}`);
  const gate = coverageGate({ resolved: resolveStory(planned, { words: cut.words }), words: cut.words, map: map2, profile });

  await mkdir(out, { recursive: true });
  await linkAssets(project, out);
  if (motion) await (adapters.spliceAudio ?? spliceAudio)(path.resolve(project, story.audio.voice), cut.segments, path.join(out, CUTDOWN_VOICE));
  await writeFile(path.join(out, "storyboard.json"), `${JSON.stringify(planned, null, 2)}\n`);
  await writeFile(path.join(out, "DIRECTION.json"), directionJson(map2));
  await writeFile(path.join(out, "NARRATION.json"), `${JSON.stringify({ words: cut.words }, null, 2)}\n`);
  const receipt = {
    schema: CUTDOWN_SCHEMA,
    source: path.relative(out, project).split(path.sep).join("/") || ".",
    to,
    section: window.section,
    title: window.title,
    window: { start: window.start, end: window.end, words: window.words, ...(cut.segments ? { segments: cut.segments } : {}) },
    duration: planned.format.duration,
    ...(motion ? { voice: CUTDOWN_VOICE } : { trim: planned.base.trim }),
    planner: plan ? { model: String(flags.model), cost_usd: plan.cost?.estimated_usd ?? null } : "deterministic",
    hook: cut.hook,
    loop_to: planned.ending?.loop_to ?? null,
    carried: plan ? [] : cut.carried,
    added: plan ? [] : cut.added,
    profile: { id: profile.id, status: gate.status, measures: gate.measures, errors: gate.errors },
    warnings
  };
  await writeFile(path.join(out, "CUTDOWN.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  return { stage: "cutdown", status: gate.status === "passed" ? "ready" : "needs-repair", out, ...receipt, next_steps: [`launchclip finish ${path.relative(process.cwd(), out) || out}`] };
}

// A style named by path is relative to the long form's folder; the Short's sits elsewhere.
function rebaseStyle(style, project, out) {
  const rebase = (name) => {
    if (typeof name !== "string" || !/[\\/]|\.json$/i.test(name) || path.isAbsolute(name)) return name;
    const file = path.resolve(project, name);
    return existsSync(file) ? path.relative(out, file).split(path.sep).join("/") : name;
  };
  if (typeof style === "string") return rebase(style);
  if (style && typeof style === "object" && typeof style.name === "string") return { ...style, name: rebase(style.name) };
  return style;
}

// The Short's narration: the long form's voice cut at each segment and joined, in order.
export async function spliceAudio(voice, segments, output) {
  if (!existsSync(voice)) throw new Error(`cutdown needs the long form's narration at ${voice}`);
  await mkdir(path.dirname(output), { recursive: true });
  const filter = segments.map((segment, k) => `[0:a]atrim=${segment.start}:${segment.end},asetpts=PTS-STARTPTS[a${k}];`).join("")
    + `${segments.map((_, k) => `[a${k}]`).join("")}concat=n=${segments.length}:v=0:a=1[out]`;
  await execFileAsync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", voice, "-filter_complex", filter, "-map", "[out]", output]);
}

function slugName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

async function stylePack(story, project) {
  const request = storyStyleRequest(story);
  if (!request) return null;
  try { return (await resolveStyleV2(request.name, { projectDir: project })).pack; }
  catch { return null; }
}

// The Short's own assets/: the long form's assets as hard links (the
// recording, the mattes and track under subject/, logos, music), so nothing is
// copied and renderers that copy the public folder (Remotion's bundle) still
// find real files. What finish makes again for the Short stays out. A link
// that fails (another volume) is a copy.
async function linkAssets(project, out) {
  const from = path.join(project, "assets");
  if (!existsSync(from)) return;
  const into = path.join(out, "assets");
  await mkdir(into, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (OWN_ASSETS.has(entry.name)) continue;
    await rm(path.join(into, entry.name), { recursive: true, force: true });
    await linkTree(path.join(from, entry.name), path.join(into, entry.name), entry.isDirectory());
  }
}

async function linkTree(source, target, directory) {
  if (directory) {
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) await linkTree(path.join(source, entry.name), path.join(target, entry.name), entry.isDirectory());
    return;
  }
  try { await link(source, target); }
  catch { await copyFile(source, target); }
}

function shortBrief(story, window, cut) {
  return [
    `A YouTube Short (9:16, ${cut.story.format.duration} s) cut from "${story.title ?? "a long video"}"${window.title ? `, section "${window.title}"` : ""}.`,
    "Re-plan it for Shorts: a visual and the hook words in the first second, a visual change every 1.5–3 s, stacked or full layouts (no split), and an ending that loops back to the first scene.",
    `Hook line: "${cut.hook.text}".`
  ].join("\n");
}

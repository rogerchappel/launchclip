// launchclip cutdown <project> --to shorts [--section <id>] [--out dir] [--max 58] [--model provider:model] [--force]
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
// Writes <out>/storyboard.json, DIRECTION.json, NARRATION.json, CUTDOWN.json
// (the receipt) and assets/ (hard links to the long form's assets, without its
// audio and captions, which finish makes again for the Short).
import { existsSync } from "node:fs";
import { copyFile, link, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CUTDOWN_SCHEMA, CUTDOWN_TARGETS, chooseCutWindow, cutdownStory } from "../kit/core/cutdown.mjs";
import { directionJson } from "../kit/core/direction.mjs";
import { resolveStory, validateStory } from "../kit/core/story.mjs";
import { storyStyleRequest } from "../kit/core/style.mjs";
import { resolveProfile } from "./profile_store.js";
import { coverageGate } from "./quality_gates.js";
import { checkStoryboard, createPlannerClient, planStoryboard } from "./storyboard_planner.js";
import { directionFileFor } from "./story_cli.js";
import { readStoryEdl } from "./story_loader.js";
import { readStorySubject, readStoryTrack } from "./subject/project.js";
import { resolveStyleV2 } from "./style_store.js";

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
  if (story.lane !== "footage-led") throw new Error(`cutdown cuts footage-led videos (a presenter's recording); this story is ${story.lane}`);
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
  const window = chooseCutWindow(map, words, { section: flags.section ? String(flags.section) : null, max, min: target.min });
  const { profile } = resolveProfile(target.profile);
  const cut = cutdownStory(resolved, { story, words, window, profile, target });
  const out = path.resolve(flags.out ? String(flags.out) : path.join(project, "cutdowns", `${window.section}-${to}`));
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
  await writeFile(path.join(out, "storyboard.json"), `${JSON.stringify(planned, null, 2)}\n`);
  await writeFile(path.join(out, "DIRECTION.json"), directionJson(map2));
  await writeFile(path.join(out, "NARRATION.json"), `${JSON.stringify({ words: cut.words }, null, 2)}\n`);
  const receipt = {
    schema: CUTDOWN_SCHEMA,
    source: path.relative(out, project).split(path.sep).join("/") || ".",
    to,
    section: window.section,
    title: window.title,
    window: { start: window.start, end: window.end, words: window.words },
    duration: planned.format.duration,
    trim: planned.base.trim,
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

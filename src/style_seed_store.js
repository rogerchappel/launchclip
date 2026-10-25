// Seeded styles in projects (docs/SEEDED_STYLES_RFC.md §4): the generated
// pack is saved at <project>/.launchclip/styles/seed-<hex>/style.json and the
// storyboard names it, like any project style. make and story plan generate
// one when no style or brand is given; `launchclip style generate | reroll |
// keep` work on them. The generator itself is kit/core/style-seed.mjs.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONSTRAINT_KEYS, generateStyle, normalizeSeed, seedSummaryLine, styleSummary, toneFromText } from "../kit/core/style-seed.mjs";
import { packCaptionsFor, validateStylePack } from "../kit/core/style.mjs";
import { suggestWorld } from "../kit/core/worlds/index.mjs";
import { homeStyleRoot, loadStyleV2 } from "./style_store.js";

const STORY_FILE = "storyboard.json";
const PREVIOUS_FILE = "previous.json";

/** A seed from the operating system's random source. */
export function freshSeed() {
  return randomBytes(4).toString("hex");
}

const stylesRoot = (projectDir) => path.join(path.resolve(projectDir), ".launchclip", "styles");
const isSeedName = (name) => typeof name === "string" && /^seed-[0-9a-f]{8}$/.test(name);

/**
 * Generate a seeded pack and save it in the project (overwriting a pack of
 * the same seed, which is the same pack). → {name, file, pack, summary, line}
 */
export async function generateProjectStyle(projectDir, { seed, tone = null, constraints = {}, clock = () => new Date().toISOString() } = {}) {
  const pack = generateStyle({ seed: seed ?? freshSeed(), tone, constraints, at: clock() });
  const file = path.join(stylesRoot(projectDir), pack.name, "style.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(pack, null, 2)}\n`);
  return { name: pack.name, file, pack, summary: styleSummary(pack), line: seedSummaryLine(pack) };
}

/** The generated pack a project already uses (the storyboard's style, else `name`), or null. */
export async function projectSeedStyle(projectDir, { storyFile = path.join(projectDir, STORY_FILE), name = null } = {}) {
  const story = await readJson(storyFile);
  const candidates = [typeof story?.style === "string" ? story.style : story?.style?.name, name].filter(Boolean);
  for (const candidate of candidates) {
    const file = path.join(stylesRoot(projectDir), candidate, "style.json");
    if (!existsSync(file)) continue;
    const loaded = await loadStyleV2(file, { source: "project" });
    if (loaded.pack.generated) return { ...loaded, summary: styleSummary(loaded.pack), line: seedSummaryLine(loaded.pack) };
  }
  return null;
}

/**
 * The art-direction constraints from flags (--tone, --theme, --world,
 * --drawing-style, --character-set, --background, --panel). --world takes
 * one world or several (repeated, or comma-separated) for the seed to pick
 * among.
 */
export function constraintFlags(flags = {}) {
  const out = {};
  for (const key of CONSTRAINT_KEYS) {
    const value = flags[key] ?? flags[key.replace(/_/g, "-")];
    if (value === undefined || value === true) continue;
    if (key === "world") {
      const worlds = [].concat(value).flatMap((entry) => String(entry).split(",")).map((entry) => entry.trim()).filter(Boolean);
      out.world = worlds.length === 1 ? worlds[0] : worlds;
    } else out[key] = String(value);
  }
  return out;
}

/** Tone for a prompt: an explicit tone wins, else the tone words in the text. */
export function promptTone(text, tone = null) {
  return tone ?? toneFromText(text);
}

/**
 * The constraints a prompt implies on top of the given ones: when the prompt
 * names a topic the worlds kit knows (suggestWorld matched a word), its
 * fitting worlds become the world constraint the seed picks within; with no
 * topic the seed keeps to its topic-neutral worlds.
 */
export function promptConstraints(text, constraints = {}) {
  if (constraints.world !== undefined) return constraints;
  const fit = suggestWorld(String(text ?? ""));
  return fit?.matched?.length && fit.worlds?.length ? { ...constraints, world: [...fit.worlds] } : constraints;
}

/**
 * A planned storyboard takes its look from the generated pack. The planner
 * already pins the brand to the pack's and names the style, but its own
 * motion grammar and caption style would win over the pack (explicit story
 * values always win in applyStyle), so they are set from the pack here.
 * Captions turned off stay off. Mutates and returns the story.
 */
export function adoptStyleLook(story, pack) {
  if (pack.brand) story.brand = JSON.parse(JSON.stringify(pack.brand));
  const grammar = pack.motion?.grammar;
  if (grammar) story.motion = { ...(story.motion && typeof story.motion === "object" ? story.motion : {}), grammar };
  const preset = packCaptionsFor(pack, story.lane)?.preset;
  for (const overlay of Array.isArray(story.overlays) ? story.overlays : []) {
    if (overlay?.type !== "captions" || overlay.style === "none" || overlay.preset === "none" || !preset) continue;
    delete overlay.style;
    overlay.preset = preset;
  }
  story.style = pack.name;
  return story;
}

/**
 * launchclip style generate --seed <hex> [--tone] [constraint flags] [--out | --project]:
 * --out is a style.json path or a directory (the pack is written to
 * <dir>/style.json); --project saves it as that project's style
 * (.launchclip/styles/seed-<hex>/style.json) for a storyboard to name;
 * with neither the pack is returned.
 */
export async function styleGenerateCommand(flags = {}, { cwd = process.cwd(), clock = () => new Date().toISOString() } = {}) {
  const constraints = constraintFlags(flags);
  const seed = flags.seed && flags.seed !== true ? normalizeSeed(flags.seed) : freshSeed();
  if (flags.project && flags.project !== true) {
    if (flags.out) throw new Error("pass --out or --project, not both");
    const made = await generateProjectStyle(path.resolve(cwd, String(flags.project)), { seed, constraints, clock });
    return { stage: "style", action: "generate", status: "ready", name: made.name, seed: made.pack.generated.seed, summary: made.summary, line: made.line, path: made.file, next: `set "style": "${made.name}" in storyboard.json and leave brand out` };
  }
  const pack = generateStyle({ seed, constraints, at: clock() });
  const result = { stage: "style", action: "generate", status: "ready", name: pack.name, seed: pack.generated.seed, summary: styleSummary(pack) };
  if (!flags.out || flags.out === true) return { ...result, pack };
  const target = path.resolve(cwd, String(flags.out));
  const file = target.endsWith(".json") ? target : path.join(target, "style.json");
  if (existsSync(file) && !flags.force) throw new Error(`${file} already exists. Pass --force to replace it`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(pack, null, 2)}\n`);
  return { ...result, path: file };
}

/**
 * launchclip style reroll [project] [--tone t] [--seed hex] [--undo]: a new
 * seed for a project that uses a generated style, keeping its art-direction
 * constraints (a new --tone replaces the old one). The old pack stays on disk
 * and is recorded in .launchclip/styles/previous.json for one undo. A project
 * with a named style or no storyboard is refused.
 */
export async function styleRerollCommand(projectArg, flags = {}, { cwd = process.cwd(), clock = () => new Date().toISOString() } = {}) {
  const project = path.resolve(cwd, projectArg ?? ".");
  const storyFile = path.join(project, STORY_FILE);
  const story = await readJson(storyFile);
  if (!story) throw new Error(`${storyFile} not found; reroll works on a project made by launchclip make or story plan`);
  const previousFile = path.join(stylesRoot(project), PREVIOUS_FILE);
  if (flags.undo) {
    const previous = await readJson(previousFile);
    if (!previous?.style || !existsSync(path.join(stylesRoot(project), previous.style, "style.json"))) throw new Error("nothing to undo: this project has no previous generated style");
    const current = typeof story.style === "string" ? story.style : null;
    await writeJson(storyFile, { ...story, style: previous.style });
    await rm(previousFile, { force: true });
    const restored = await projectSeedStyle(project);
    return { stage: "style", action: "reroll", status: "undone", project, name: previous.style, replaced: current, summary: restored?.summary ?? null, line: restored?.line ?? null };
  }
  const current = await projectSeedStyle(project);
  if (!current) {
    const named = typeof story.style === "string" ? story.style : story.style?.name;
    throw new Error(named ? `this project uses the style "${named}", which was not generated from a seed; reroll changes only generated styles` : "this project names no style; run launchclip style generate, or make the video again without --style");
  }
  const old = current.pack.generated;
  const constraints = { ...(old.constraints ?? {}), ...constraintFlags(flags) };
  if (old.tone && !constraints.tone) constraints.tone = old.tone;
  let seed = flags.seed && flags.seed !== true ? normalizeSeed(flags.seed) : freshSeed();
  while (`seed-${seed}` === current.name) seed = freshSeed();
  const next = await generateProjectStyle(project, { seed, constraints, clock });
  await writeJson(storyFile, { ...story, style: next.name });
  await writeJson(previousFile, { style: current.name, replaced_by: next.name, at: clock() });
  return { stage: "style", action: "reroll", status: "ready", project, name: next.name, previous: current.name, summary: next.summary, line: next.line, next: `launchclip finish ${path.relative(cwd, project) || "."} renders the new look; launchclip style reroll --undo goes back` };
}

/**
 * launchclip style keep <project> --as <name>: copy the project's generated
 * pack to ~/.launchclip/styles/<name>/style.json (renamed; the generated
 * block is kept as provenance), so it becomes a reusable personal style.
 */
export async function styleKeepCommand(projectArg, flags = {}, { cwd = process.cwd(), home } = {}) {
  if (!projectArg) throw new Error("Missing project path: launchclip style keep <project> --as <name>");
  const name = flags.as && flags.as !== true ? String(flags.as).trim() : null;
  if (!name) throw new Error("style keep needs --as <name>");
  if (isSeedName(name)) throw new Error("--as needs a name of your own, not a seed name");
  const project = path.resolve(cwd, projectArg);
  const current = await projectSeedStyle(project);
  if (!current) throw new Error(`${project} has no generated style to keep`);
  const pack = { ...current.pack, name, description: `${current.pack.description ?? ""} Kept as ${name}.`.trim() };
  const validation = validateStylePack(pack);
  if (!validation.ok) throw new Error(`the kept style is invalid:\n- ${validation.errors.join("\n- ")}`);
  const dir = path.join(homeStyleRoot({ home }), name);
  const file = path.join(dir, "style.json");
  if (existsSync(file) && !flags.force) throw new Error(`a personal style named ${name} already exists (${file}). Pass --force to replace it`);
  await mkdir(dir, { recursive: true });
  const staging = `${file}.tmp`;
  await writeFile(staging, `${JSON.stringify(pack, null, 2)}\n`);
  await rename(staging, file);
  return { stage: "style", action: "keep", status: "ready", name, from: current.name, path: file, next: `use it anywhere with --style ${name}` };
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}


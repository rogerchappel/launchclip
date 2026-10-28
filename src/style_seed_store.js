// Seeded styles in projects (docs/SEEDED_STYLES_RFC.md §4): the generated
// pack is saved at <project>/.launchclip/styles/seed-<hex>/style.json and the
// storyboard names it, like any project style. make and story plan generate
// one when no style or brand is given; `launchclip style generate | reroll |
// keep` work on them. The generator itself is kit/core/style-seed.mjs.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONSTRAINT_KEYS, NEAR_DUPLICATE, generateStyle, normalizeSeed, pinStyle, rerollStyle, seedSummaryLine, styleDistanceReport, styleSummary, toneFromText } from "@launchclip/core/style-seed.mjs";
import { mediumFromText } from "@launchclip/core/medium.mjs";
import { packCaptionsFor, validateStylePack } from "@launchclip/core/style.mjs";
import { suggestWorld } from "@launchclip/core/worlds/index.mjs";
import { homeStyleRoot, loadStyleV2, resolveStyleV2 } from "./style_store.js";
import { paletteClusters, pixelsFromFrames, sampleFrames } from "./style_reference.js";

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
export async function generateProjectStyle(projectDir, { seed, tone = null, constraints = {}, brand, avoid = [], clock = () => new Date().toISOString() } = {}) {
  const pack = generateStyle({ seed: seed ?? freshSeed(), tone, constraints, brand, avoid, at: clock() });
  return saveProjectStyle(projectDir, pack);
}

/** Save a generated pack as a project style. → {name, file, pack, summary, line} */
export async function saveProjectStyle(projectDir, pack) {
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
 * --drawing-style, --character-set, --background, --panel, --medium). --world takes
 * one world or several (repeated, or comma-separated) for the seed to pick
 * among.
 */
export function constraintFlags(flags = {}) {
  const out = {};
  for (const key of CONSTRAINT_KEYS) {
    const value = flags[key] ?? flags[key.replace(/_/g, "-")];
    if (key === "overshoot" && value !== undefined) { out.overshoot = value === true || value === "true"; continue; }
    if (value === undefined || value === true) continue;
    if (key === "world") {
      const worlds = [].concat(value).flatMap((entry) => String(entry).split(",")).map((entry) => entry.trim()).filter(Boolean);
      out.world = worlds.length === 1 ? worlds[0] : worlds;
    } else out[key] = String(value);
  }
  return out;
}

/**
 * Tone for a prompt: an explicit tone wins, else the tone words in the text,
 * else the tone of the medium it names ("inked, like a graphic novel" is
 * serious; kit/core/medium.mjs MEDIUM_LOOKS).
 */
export function promptTone(text, tone = null) {
  return tone ?? toneFromText(text) ?? mediumFromText(text)?.tone ?? null;
}

/**
 * The constraints a prompt implies on top of the given ones: when the prompt
 * names a topic the worlds kit knows (suggestWorld matched a word), its
 * fitting worlds become the world constraint the seed picks within; with no
 * topic the seed keeps to its topic-neutral worlds. When it describes the
 * look as a medium in plain words ("soft watercolour, dreamy", "crayon on
 * paper, for kids"), that medium is painted over every frame, and the theme
 * and background that go with it apply unless given.
 */
export function promptConstraints(text, constraints = {}) {
  let out = constraints;
  if (out.world === undefined) {
    const fit = suggestWorld(String(text ?? ""));
    if (fit?.matched?.length && fit.worlds?.length) out = { ...out, world: [...fit.worlds] };
  }
  const painted = out.medium === undefined ? mediumFromText(text) : null;
  if (painted) out = { ...out, medium: painted.medium, ...(out.theme === undefined ? { theme: painted.theme } : {}), ...(out.background === undefined ? { background: painted.background } : {}) };
  return out;
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

/** The colours of an image, most covered first (k-means over one sampled frame). */
export async function imageColors(file, { k = 6 } = {}) {
  const { frames } = await sampleFrames(file, { image: true });
  return paletteClusters(pixelsFromFrames(frames), { k }).map((entry) => entry.hex);
}

const listFlag = (value) => (value === undefined || value === true ? [] : [].concat(value).flatMap((entry) => String(entry).split(",")).map((entry) => entry.trim()).filter(Boolean));

/**
 * The brand a host gives on the command line: --brand <brand.json> (the
 * generateStyle brand object), then --name, --colors "#0b3d91,accent=#f2a900",
 * --fonts "Display,Body[,Meta]", --brand-tone "warm, friendly", --industry,
 * --logo <file> and --reference <file> (repeatable) on top. An SVG's colours
 * are read from its markup; a raster logo's or still's are extracted
 * (imageColors, or adapters.colors). Paths stay as given, relative to cwd.
 * → a brand object, or undefined when none is given.
 */
export async function brandFlags(flags = {}, { cwd = process.cwd(), colors = imageColors } = {}) {
  const base = flags.brand && flags.brand !== true ? JSON.parse(await readFile(path.resolve(cwd, String(flags.brand)), "utf8")) : {};
  const brand = { ...base };
  if (flags.name && flags.name !== true) brand.name = String(flags.name);
  const colorList = listFlag(flags.colors);
  if (colorList.length) {
    const roles = colorList.filter((entry) => entry.includes("="));
    brand.colors = roles.length
      ? [...colorList.map((entry) => (entry.includes("=") ? { role: entry.split("=")[0].trim(), hex: entry.split("=")[1].trim() } : entry))]
      : colorList;
  }
  const fonts = listFlag(flags.fonts);
  if (fonts.length) brand.fonts = fonts;
  if (flags["brand-tone"] && flags["brand-tone"] !== true) brand.tone = String(flags["brand-tone"]);
  if (flags.industry && flags.industry !== true) brand.industry = String(flags.industry);
  const image = async (file) => {
    const resolved = path.resolve(cwd, file);
    if (/\.svg$/i.test(file)) return { src: file, svg: await readFile(resolved, "utf8") };
    return { src: file, colors: await colors(resolved) };
  };
  if (flags.logo && flags.logo !== true) brand.logo = await image(String(flags.logo));
  const references = listFlag(flags.reference);
  if (references.length) brand.references = await Promise.all(references.map(image));
  return Object.keys(brand).length ? brand : undefined;
}

/** A style to compare or preview: a style.json path, a project directory (its storyboard's style), or a style name. → pack */
export async function loadStyleArg(value, { cwd = process.cwd() } = {}) {
  if (!value || value === true) throw new Error("name a style: a style.json, a project directory or a style name");
  const target = path.resolve(cwd, String(value));
  if (existsSync(path.join(target, STORY_FILE))) {
    const story = await readJson(path.join(target, STORY_FILE));
    const name = typeof story?.style === "string" ? story.style : story?.style?.name;
    if (!name) throw new Error(`${target} names no style`);
    return (await resolveStyleV2(name, { projectDir: target })).pack;
  }
  return (await resolveStyleV2(String(value), { projectDir: cwd })).pack;
}

/**
 * launchclip style generate --seed <hex> [--tone] [constraint flags] [--out | --project]:
 * --out is a style.json path or a directory (the pack is written to
 * <dir>/style.json); --project saves it as that project's style
 * (.launchclip/styles/seed-<hex>/style.json) for a storyboard to name;
 * with neither the pack is returned.
 */
export async function styleGenerateCommand(flags = {}, { cwd = process.cwd(), clock = () => new Date().toISOString(), colors } = {}) {
  const constraints = constraintFlags(flags);
  const seed = flags.seed && flags.seed !== true ? normalizeSeed(flags.seed) : freshSeed();
  const brand = await brandFlags(flags, { cwd, ...(colors ? { colors } : {}) });
  const avoid = await Promise.all(listFlag(flags.avoid).map((entry) => loadStyleArg(entry, { cwd })));
  if (flags.project && flags.project !== true) {
    if (flags.out) throw new Error("pass --out or --project, not both");
    const made = await generateProjectStyle(path.resolve(cwd, String(flags.project)), { seed, constraints, brand, avoid, clock });
    return { stage: "style", action: "generate", status: "ready", name: made.name, seed: made.pack.generated.seed, summary: made.summary, line: made.line, path: made.file, next: `set "style": "${made.name}" in storyboard.json and leave brand out` };
  }
  const pack = generateStyle({ seed, constraints, brand, avoid, at: clock() });
  const result = { stage: "style", action: "generate", status: "ready", name: pack.name, seed: pack.generated.seed, summary: styleSummary(pack), ...(pack.generated.adjusted ? { adjusted: pack.generated.adjusted } : {}), ...(pack.generated.substituted ? { substituted: pack.generated.substituted } : {}) };
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
  if (current.pack.generated.pinned && !flags.force) throw new Error(`${current.name} is pinned; launchclip style pin ${projectArg ?? "."} --off unpins it (or pass --force)`);
  let seed = flags.seed && flags.seed !== true ? normalizeSeed(flags.seed) : freshSeed();
  while (`seed-${seed}` === current.name) seed = freshSeed();
  // rerollStyle keeps the brand and direction (generated.inputs and
  // constraints), draws with the current generator and steps away from the old look.
  const base = { ...current.pack, generated: { ...current.pack.generated, constraints: { ...(current.pack.generated.constraints ?? {}), ...constraintFlags(flags) } } };
  const next = await saveProjectStyle(project, rerollStyle(base, { seed, force: true, at: clock(), ...(flags.tone && flags.tone !== true ? { tone: String(flags.tone) } : {}) }));
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

/**
 * launchclip style pin [<project> | <style.json>] [--off]: pin a generated
 * style so reroll refuses it (until --off, or reroll --force).
 */
export async function stylePinCommand(target, flags = {}, { cwd = process.cwd() } = {}) {
  const location = path.resolve(cwd, target ?? ".");
  let file = location;
  if (existsSync(path.join(location, STORY_FILE))) {
    const current = await projectSeedStyle(location);
    if (!current) throw new Error(`${location} has no generated style to pin`);
    file = current.file;
  } else if (!location.endsWith(".json")) file = path.join(location, "style.json");
  const pack = await readJson(file);
  if (!pack?.generated) throw new Error(`${file} is not a generated style`);
  const pinned = flags.off !== true;
  await writeJson(file, pinStyle(pack, pinned));
  return { stage: "style", action: "pin", status: "ready", name: pack.name, pinned, path: file };
}

/**
 * launchclip style preview <style> --out preview.mp4 [--renderer hyperframes|remotion]
 * [--aspect 16:9|9:16|1:1] [--duration 8-12] [--title] [--kicker] [--quality]:
 * render the style's preview reel (title, chart, card, a camera move and a
 * backdrop change).
 */
export async function stylePreviewCommand(target, flags = {}, { cwd = process.cwd(), render } = {}) {
  const pack = await loadStyleArg(target, { cwd });
  const out = flags.out && flags.out !== true ? path.resolve(cwd, String(flags.out)) : path.resolve(cwd, `${pack.name}-preview.mp4`);
  const { renderStylePreview } = await import("./style_preview.js");
  const options = { out, renderer: flags.renderer ?? "hyperframes", quality: flags.quality ?? "draft", ...(flags.aspect ? { aspect: String(flags.aspect) } : {}), ...(flags.duration ? { duration: Number(flags.duration) } : {}), ...(flags.title ? { title: String(flags.title) } : {}), ...(flags.kicker ? { kicker: String(flags.kicker) } : {}) };
  const result = await (render ?? renderStylePreview)(pack, options);
  return { stage: "style", action: "preview", status: result.status, name: pack.name, renderer: result.renderer, video: result.video, duration: result.duration, warnings: result.warnings ?? [] };
}

/**
 * launchclip style distance <a> <b> [<c> ...]: how different styles look,
 * every pair, with the parts; a pair under NEAR_DUPLICATE reads as one brand.
 */
export async function styleDistanceCommand(targets = [], { cwd = process.cwd() } = {}) {
  if (targets.length < 2) throw new Error("style distance needs at least two styles (style.json, project directory or style name)");
  const packs = await Promise.all(targets.map((entry) => loadStyleArg(entry, { cwd })));
  const pairs = [];
  for (let i = 0; i < packs.length; i += 1) {
    for (let j = i + 1; j < packs.length; j += 1) {
      const report = styleDistanceReport(packs[i], packs[j]);
      pairs.push({ a: packs[i].name, b: packs[j].name, distance: report.distance, parts: report.parts, near_duplicate: report.distance < NEAR_DUPLICATE });
    }
  }
  return { stage: "style", action: "distance", status: pairs.some((pair) => pair.near_duplicate) ? "near-duplicate" : "distinct", threshold: NEAR_DUPLICATE, pairs };
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}


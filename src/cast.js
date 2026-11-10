// Character casts: `launchclip cast list / show / sheet`, and the cast
// consistency gate `launchclip finish` runs (docs/VIDEO_QUALITY_RFC.md §10.5).
//
//   cast list [project|storyboard.json]   the starter cast, the saved
//                                          characters, plus a story's cast
//   cast show <id> [--story <file>]        one character's params, colours, voice
//   cast sheet <project|storyboard.json>   every character in every pose and
//                                          expression the story uses, rendered
//                                          once to qa/cast-sheet.png (+ .json)
//   cast sheet <saved id>                  one saved character's design sheet
//
// Designing characters (create, edit, options, export, import) is
// src/cast_design.js; saved characters live in src/character_store.js.
//
// The sheet draws characters with the same view tree the modules render
// (kit/core/characters/), in Chromium, so what the sheet shows is what the
// scenes show.
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { STARTER_CAST } from "@launchclip/core/characters/cast.mjs";
import { castPlacement } from "@launchclip/core/characters/placement.mjs";
import { SEATED_SETS } from "@launchclip/core/characters/sets.mjs";
import { KOKORO_VOICES, castConsistency, castMember, resolveStoryCast, validateCastCues } from "@launchclip/core/characters/cues.mjs";
import { EXPRESSIONS, POSES } from "@launchclip/core/characters/rig.mjs";
import { sceneJoints } from "@launchclip/core/characters/acting.mjs";
import { drawCharacter, styleGeometry, styleHeight } from "@launchclip/core/characters/styles.mjs";
import { characterView } from "@launchclip/core/characters/view.mjs";
import { CAST_MODULES } from "@launchclip/core/story.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { renderNode } from "../kit/hyperframes/catalog-b.mjs";
import { applyProjectStyle } from "./story_style.js";
import { characterCastEntry } from "@launchclip/core/characters/character.mjs";
import { listCharacters, loadCharacter } from "./character_store.js";

export const CAST_SHEET = Object.freeze({ png: "qa/cast-sheet.png", json: "qa/cast-sheet.json" });

async function loadStoryFile(target) {
  if (!target) return { story: null, project: null };
  const info = await stat(target).catch(() => null);
  if (!info) throw new Error(`${target} does not exist`);
  const file = info.isDirectory() ? path.join(target, "storyboard.json") : target;
  if (!existsSync(file)) throw new Error(`${file} does not exist`);
  const project = path.dirname(file);
  // A style pack (story.style) fills the brand and the cast's colour mapping,
  // as finish does, so the sheet draws the characters in the video's colours.
  const { story } = await applyProjectStyle(JSON.parse(await readFile(file, "utf8")), { projectDir: project });
  const directionFile = path.join(project, "DIRECTION.json");
  const direction = existsSync(directionFile) ? JSON.parse(await readFile(directionFile, "utf8")) : null;
  return { story, project, file, direction };
}

/**
 * Who acts in a story and how: for each character, the poses and
 * expressions its scenes (and the direction map's cues) use, in first-use
 * order. → Map id → {poses: [], expressions: []}
 */
export function castUsage(story, direction = null) {
  const usage = new Map();
  const note = (id, pose, expression) => {
    if (typeof id !== "string") return;
    const entry = usage.get(id) ?? { poses: [], expressions: [] };
    if (pose && POSES.includes(pose) && !entry.poses.includes(pose)) entry.poses.push(pose);
    if (expression && EXPRESSIONS.includes(expression) && !entry.expressions.includes(expression)) entry.expressions.push(expression);
    usage.set(id, entry);
  };
  for (const scene of Array.isArray(story?.scenes) ? story.scenes : []) {
    if (!CAST_MODULES.includes(scene?.module)) continue;
    const params = scene.params ?? {};
    const seated = SEATED_SETS.includes(params.set);
    const actors = scene.module === "cast-scene" ? (Array.isArray(params.cast) ? params.cast : []) : [{ ...params, id: params.character }];
    for (const actor of actors) {
      note(actor?.id, actor?.pose ?? (seated ? "sit" : "stand"), actor?.expression ?? "neutral");
      for (const cue of Array.isArray(actor?.cues) ? actor.cues : []) note(actor.id, cue?.pose, cue?.expression);
    }
  }
  for (const section of Array.isArray(direction?.sections) ? direction.sections : []) {
    for (const line of Array.isArray(section?.lines) ? section.lines : []) {
      for (const cue of Array.isArray(line?.cast) ? line.cast : []) note(cue?.id, cue?.pose, cue?.expression);
    }
  }
  return usage;
}

/** `cast list`: the starter cast, the saved characters (the project's, then the library's) and, with a story, its cast. */
export async function castList(target, { project, home } = {}) {
  const { story, project: storyProject } = await loadStoryFile(target);
  const saved = await listCharacters({ projectDir: project ?? storyProject ?? process.cwd(), home });
  const rows = STARTER_CAST.map((entry) => ({ id: entry.id, name: entry.name, summary: entry.summary, voice: entry.voice, ...(entry.params.kind ? { kind: entry.params.kind } : {}), source: "starter" }));
  let storyRows = [];
  if (story?.cast) {
    const resolved = resolveStoryCast(story);
    storyRows = [...resolved.members.values()].map((member) => ({ id: member.id, name: member.name, voice: member.voice, build: member.params?.build ?? null, hair: member.params?.hair?.style ?? null, ...(member.params?.kind ? { kind: member.params.kind } : {}), ...(member.sprite ? { art: member.art } : {}), source: "story" }));
  }
  return { stage: "cast", action: "list", status: "ready", starter: rows, saved, story: storyRows };
}

/** `cast show <id>`: params, resolved colours and voice. */
export async function castShow(id, { story: storyPath, project, home } = {}) {
  if (!id) throw new Error("cast show needs a character id (see launchclip cast list)");
  const { story, project: storyProject } = await loadStoryFile(storyPath);
  const resolved = resolveStoryCast(story ?? {});
  // A saved character outside a story's cast: its own file, drawn in its own style.
  const saved = resolved.members.has(id) || resolved.listed ? null : await loadCharacter(id, { projectDir: project ?? storyProject ?? process.cwd(), home });
  if (saved) {
    const member = castMember(resolveStoryCast({ brand: story?.brand, cast: { style: saved.character.style, characters: [characterCastEntry(saved.character)] } }), id);
    return { stage: "cast", action: "show", status: "ready", id: member.id, name: member.name, personality: saved.character.personality ?? null, voice: member.voice, style: member.style, starter: false, saved: saved.source, file: saved.file, params: member.params, colors: member.colors, fingerprint: member.fingerprint };
  }
  const member = castMember(resolved, id);
  return { stage: "cast", action: "show", status: "ready", id: member.id, name: member.name, voice: member.voice, style: member.style, starter: member.starter, params: member.params, colors: member.colors, fingerprint: member.fingerprint };
}

// ---------------------------------------------------------------------------
// Sheet

const CELL = { width: 300, height: 420, face: 190 };

function cellNode(member, pose, expression, id, { face = false } = {}) {
  const geometry = styleGeometry(member.style, member.params);
  const joints = sceneJoints(pose, { facing: "right", geometry, seated: pose === "sit", params: member.params });
  const drawing = drawCharacter(member.style, member.params, member.colors, { id, joints, expression, expressions: [expression], facing: "right" });
  if (face) {
    // bodyY: a seated body (a wheelchair user's in every pose) sits lower, and the close-up follows it.
    const headY = geometry.hipY - geometry.torso - geometry.neck + geometry.head.cy + (joints.bodyY ?? 0);
    const scale = (CELL.face * 0.34) / geometry.head.ry;
    // (A four-legged character's head is ahead of its body's centre.)
    return characterView(drawing, { id, x: CELL.face / 2 - (geometry.head.x ?? 0) * scale, y: CELL.face * 0.56 - headY * scale, scale });
  }
  // People share one scale (so heights compare); the shorter kinds (animals, mascots, objects) are drawn larger to read.
  const scale = (CELL.height - 70) / Math.max(member.params.kind ? 820 : 1150, styleHeight(member.style, member.params));
  return characterView(drawing, { id, x: CELL.width / 2, y: CELL.height - 24, scale });
}

/** The sheet as one HTML page and its rows (characters × poses, then faces). */
export function castSheetHtml(story, usage, { title = "Cast sheet" } = {}) {
  const resolved = resolveStoryCast(story ?? {});
  const bg = story?.brand?.colors?.paper ?? "#f2eee6";
  const ink = "#231e28";
  const rows = [];
  let html = "";
  let n = 0;
  for (const [id, use] of usage) {
    const member = castMember(resolved, id);
    const poses = use.poses.length ? use.poses : ["stand"];
    const expressions = use.expressions.length ? use.expressions : ["neutral"];
    rows.push({ id, name: member.name, poses, expressions, fingerprint: member.fingerprint, voice: member.voice });
    const cells = poses.map((pose) => `<figure class="cell"><div class="stage">${renderNode(cellNode(member, pose, expressions[0], `k${n++}`))}</div><figcaption>${pose}</figcaption></figure>`).join("");
    const faces = expressions.map((expression) => `<figure class="face"><div class="stage">${renderNode(cellNode(member, "stand", expression, `k${n++}`, { face: true }))}</div><figcaption>${expression}</figcaption></figure>`).join("");
    html += `<section><h2>${member.name} <small>${id}${member.voice ? ` · ${member.voice}` : ""}</small></h2><div class="row">${cells}${faces}</div></section>`;
  }
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
body{margin:0;padding:28px 32px;background:${bg};font-family:Helvetica,Arial,sans-serif;color:${ink}}
h1{font-size:30px;margin:0 0 18px}h2{font-size:22px;margin:18px 0 8px}small{font-weight:400;opacity:.6;font-size:15px}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}
figure{margin:0;background:#ffffff8c;border-radius:14px;overflow:hidden}
.cell .stage{position:relative;width:${CELL.width}px;height:${CELL.height}px;overflow:hidden}
.face .stage{position:relative;width:${CELL.face}px;height:${CELL.face}px;overflow:hidden}
figcaption{font-size:14px;text-align:center;padding:6px 0 8px;opacity:.75}
</style></head><body><h1>${title}</h1>${html}</body></html>`;
  return { html: page, rows };
}

/** `cast sheet`: render the story's cast sheet to a PNG with Chromium. */
export async function castSheet(target, { out, report: reportPath, ids, chromium } = {}) {
  const { story, project, direction } = await loadStoryFile(target);
  if (!story) throw new Error("cast sheet needs a project or storyboard.json");
  let usage = castUsage(story, direction);
  if (ids) {
    const wanted = String(ids).split(",").map((id) => id.trim()).filter(Boolean);
    usage = new Map(wanted.map((id) => [id, usage.get(id) ?? { poses: [...POSES], expressions: [...EXPRESSIONS] }]));
  }
  if (!usage.size) {
    const resolved = resolveStoryCast(story);
    for (const id of resolved.members.keys()) usage.set(id, { poses: ["stand"], expressions: ["neutral"] });
  }
  if (!usage.size) throw new Error("the story has no characters: add story.cast or cast-scene / character-cameo scenes");
  const { html, rows } = castSheetHtml(story, usage, { title: story.title ? `Cast sheet: ${story.title}` : "Cast sheet" });
  const pngPath = path.resolve(project, out ?? CAST_SHEET.png);
  const jsonPath = path.resolve(project, reportPath ?? CAST_SHEET.json);
  await mkdir(path.dirname(pngPath), { recursive: true });
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await screenshotHtml(html, pngPath, { chromium });
  const report = { schema: "launchclip.cast-sheet.v1", png: path.relative(project, pngPath), characters: rows };
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  return { stage: "cast", action: "sheet", status: "ready", png: pngPath, json: jsonPath, characters: rows.map((row) => ({ id: row.id, poses: row.poses, expressions: row.expressions })) };
}

export async function screenshotHtml(html, file, { chromium } = {}) {
  const { chromiumSearch, chromiumMissingMessage, loadPlaywright } = await import("./demo/record.js");
  const playwrightChromium = await loadPlaywright();
  if (!playwrightChromium) throw new Error("cast sheet needs Playwright (npm i playwright)");
  let executablePath = chromium ?? null;
  if (!executablePath) {
    // Playwright's own build, a system Chrome or the browser the renderers use: never a download.
    let pinned = null;
    try { pinned = playwrightChromium.executablePath(); } catch { pinned = null; }
    const search = await chromiumSearch({ playwrightPath: pinned });
    if (!search.path) throw new Error(`cast sheet needs a browser: ${chromiumMissingMessage(search.looked)}`);
    executablePath = search.path;
  }
  const browser = await playwrightChromium.launch({ executablePath });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: file, fullPage: true });
  } finally {
    await browser.close();
  }
}

export async function runCastCommand(action, name, flags = {}) {
  if (action === "list") return castList(name ?? flags.story, { project: flags.project });
  if (action === "show") return castShow(name, { story: flags.story, project: flags.project });
  if (action === "sheet") {
    // A saved character's id (not a path on disk) draws that character's design sheet.
    if (name && !existsSync(name) && /^[a-z][a-z0-9-]{0,23}$/.test(name)) return (await import("./cast_design.js")).castCharacterSheet(name, flags);
    return castSheet(name ?? flags.story, { out: flags.out, report: flags.report, ids: flags.ids });
  }
  if (["create", "edit", "options", "export", "import"].includes(action)) {
    const design = await import("./cast_design.js");
    if (action === "create") return design.castCreate(name, flags);
    if (action === "edit") return design.castEdit(name, flags);
    if (action === "options") return design.castOptions(name);
    if (action === "export") return design.castExport(Array.isArray(flags.names) ? flags.names : name ? [name] : [], flags);
    return design.castImport(name, flags);
  }
  if (action === "sprites") {
    const { makeSpriteCast } = await import("./sprite_cast.js");
    const only = typeof flags.ids === "string" ? flags.ids.split(",").map((id) => id.trim()).filter(Boolean) : null;
    return makeSpriteCast(name ?? flags.story ?? ".", { dryRun: Boolean(flags["dry-run"]), force: Boolean(flags.force), only, say: (line) => process.stderr.write(`${line}\n`) });
  }
  throw new Error(`Unknown cast action: ${action ?? "(none)"}; use list, show, sheet, create, edit, options, export, import or sprites`);
}

// ---------------------------------------------------------------------------
// The finish gate

/**
 * The cast consistency gate for a resolved story: the story cast is valid,
 * every character scene resolves, the direction map's cast cues name real
 * characters, poses, expressions and sets, each character is drawn from the
 * same params in every scene, every limb and prop stays on the canvas and in
 * the safe zone, characters keep their sides between shots
 * (characters/placement.mjs), and a speaking character's voice is a known
 * local Kokoro voice. → {status: "passed" | "failed" | "skipped", findings, characters}
 */
export function castGate(story, { direction = null } = {}) {
  const scenes = (Array.isArray(story?.scenes) ? story.scenes : []).filter((scene) => CAST_MODULES.includes(scene?.module));
  const lines = (Array.isArray(direction?.sections) ? direction.sections : []).flatMap((section, s) => (Array.isArray(section?.lines) ? section.lines : []).map((line, l) => ({ line, path: `DIRECTION.json sections[${s}].lines[${l}]` }))).filter(({ line }) => line?.cast || line?.set);
  if (!scenes.length && !story?.cast && !lines.length) return { status: "skipped", reason: "no characters in this story", findings: [] };
  const findings = [];
  let resolved = null;
  try { resolved = resolveStoryCast(story); } catch (error) { findings.push({ scene: null, id: null, detail: `story cast: ${error.message}` }); }
  const models = [];
  for (const scene of scenes) {
    try { models.push(resolveModule(scene, story)); } catch (error) { findings.push({ scene: scene.id, id: null, detail: error.message }); }
  }
  if (resolved) {
    findings.push(...castConsistency(story, models));
    // Every limb and prop on the canvas and in the safe zone; sides kept between shots.
    findings.push(...castPlacement(story, models));
    for (const { line, path: where } of lines) for (const detail of validateCastCues(line, resolved, { path: where })) findings.push({ scene: null, id: null, detail });
    for (const member of resolved.members.values()) {
      if (member.voice && /^[ab][fm]_/.test(member.voice) && !KOKORO_VOICES.includes(member.voice)) findings.push({ scene: null, id: member.id, detail: `${member.id}'s voice ${member.voice} is not a local Kokoro voice (${KOKORO_VOICES.join(", ")})` });
    }
  }
  const characters = [...new Set(models.flatMap((model) => model.content.actors.map((actor) => actor.id)))];
  return { status: findings.length ? "failed" : "passed", findings, characters };
}

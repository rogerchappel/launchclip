// The hand-in contract (docs/ANIMATION_PIPELINE_RFC.md §4.5, §5): HANDIN.json
// names art made elsewhere for a character story, LaunchClip checks it and
// answers in qa/hand-in.json, and finish draws a passing asset in place of
// the code-drawn one.
//
//   launchclip handin check <project> [--look mixed] [--model provider:model] [--json]
//
//   checkHandIn(project, {story, shots, judge, look}) → report | null (no HANDIN.json)
//   applyHandIn(story, report)                          → the story with used assets in place
//
// What is applied: a whole shot replaces its shot with a `clip` scene; a plate
// is drawn behind the cast of every shot in its place (cast-scene
// params.plate, with the set's furniture alone on the plate's floor). Both are
// kit modules, so the two renderers draw them from the same tree. Sprite casts
// are reported and not applied yet: the rig draws every character.
//
// One look per video (§5.5): whole shots are used only when every shot has one
// that passes (`--look mixed` uses each that passes); a place uses its plate in
// every shot there or in none. A rejected asset falls back to the code-drawn
// version, and handin check exits non-zero so a host can remake it.
//
// The bible check (§5.4): the manifest's bible_hash is the frozen bible's, and
// a vision judge (the "hand-in judge" model role) compares the art with the
// bible's sheets and must_keep. With no judge it is recorded as not-checked,
// never passed, and the report is ready-for-review.
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { BIBLE_FILE } from "@launchclip/core/bible.mjs";
import { SET_INFO } from "@launchclip/core/characters/sets.mjs";
import { ffmpegStill, measureFootage } from "./asset_provider.js";
import { writeFileAtomic } from "./atomic_write.js";
import { probeVideo } from "./renderer_eval.js";
import { shotList } from "./story_shots.js";

export const HANDIN_FILE = "HANDIN.json";
export const HANDIN_SCHEMA = "launchclip.hand-in.v1";
export const HANDIN_REPORT = "qa/hand-in.json";
export const HANDIN_REPORT_SCHEMA = "launchclip.hand-in-report.v1";
export const HANDIN_LOOKS = Object.freeze(["one", "mixed"]);
// Mean frame-to-frame change (measureFootage) below which a whole shot is a frozen picture.
// shortcut: a guess under encoder noise on a held still; tune on fixtures of real hand-in clips.
export const FROZEN_MOTION = 0.001;
// How far a plate's aspect may differ from the story's, and the smallest share of its width it may be.
export const PLATE_ASPECT_TOLERANCE = 0.01;
export const PLATE_MIN_WIDTH_SHARE = 0.5;

const VIDEO = /\.(mp4|webm|mov|m4v)$/i;
const IMAGE = /\.(png|jpe?g|webp)$/i;
const isObj = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim() !== "";
const round3 = (value) => Math.round(value * 1000) / 1000;
const castOf = (bible) => (Array.isArray(bible?.cast) ? bible.cast : Array.isArray(bible?.cast?.characters) ? bible.cast.characters : []);

/**
 * Check a project's HANDIN.json. story: the resolved storyboard (finish's, or
 * read from disk); shots: its shot list (src/story_shots.js), default from the
 * story. judge({kind, images, characters, place}) → {ok, findings}: the
 * vision judge, or null. look: "one" (default) or "mixed".
 * hooks: probe, measure, still (stand-ins for ffprobe/ffmpeg).
 * → {schema, status, look, assets: [...], notes} | null when there is no HANDIN.json
 */
export async function checkHandIn(project, { story, shots = shotList(story).shots, judge = null, look = "one", probe = probeVideo, measure = measureFootage, still = ffmpegStill } = {}) {
  const root = path.resolve(project);
  const file = path.join(root, HANDIN_FILE);
  if (!existsSync(file)) return null;
  if (!HANDIN_LOOKS.includes(look)) throw new Error(`--look must be ${HANDIN_LOOKS.join(" or ")}; got ${look}`);
  let manifest;
  try { manifest = JSON.parse(await readFile(file, "utf8")); } catch (error) { throw new Error(`${HANDIN_FILE} is not readable JSON: ${error.message}`); }
  const bible = existsSync(path.join(root, BIBLE_FILE)) ? JSON.parse(await readFile(path.join(root, BIBLE_FILE), "utf8")) : null;
  const format = { width: Number(story?.format?.width), height: Number(story?.format?.height), fps: Number(story?.resolved?.fps ?? story?.format?.fps ?? 30) };
  const scenes = new Map((story?.scenes ?? []).map((scene) => [scene.id, scene]));
  const byId = new Map(shots.map((shot) => [shot.id, shot]));

  // A manifest-wide problem rejects every entry with the same reason.
  const whole = !isObj(manifest) ? `${HANDIN_FILE} must be an object`
    : manifest.schema !== HANDIN_SCHEMA ? `${HANDIN_FILE} schema must be "${HANDIN_SCHEMA}"; got ${JSON.stringify(manifest.schema)}`
    : bible?.frozen !== true ? `the project has no frozen show bible (${BIBLE_FILE}) to check hand-in art against; freeze it with launchclip bible freeze`
    : manifest.bible_hash !== bible.hash ? `${HANDIN_FILE} was made against bible ${short(manifest.bible_hash)}; the frozen bible is ${short(bible.hash)}. Check the art against the new sheets and set bible_hash`
    : null;
  const list = (key) => (Array.isArray(manifest?.[key]) ? manifest[key] : []);
  const assets = [];

  // Sprite casts: listed, not applied yet (the render phase for them is still to come).
  for (const entry of list("cast")) assets.push({ kind: "sprite-cast", character: entry?.character ?? null, file: entry?.art ?? null, status: "unused", reason: "sprite casts are not drawn by finish yet; the rig draws every character" });

  const seenShots = new Set();
  for (const entry of list("shots")) {
    const asset = { kind: "whole-shot", shot: entry?.shot ?? null, file: entry?.clip ?? null, source_start: Number(entry?.source_start ?? 0) || 0, source: entry?.source ?? null };
    const shot = byId.get(asset.shot);
    asset.reason = whole
      ?? (seenShots.has(asset.shot) ? `${HANDIN_FILE} hands in shot ${asset.shot} twice` : null)
      ?? (!shot ? `${JSON.stringify(asset.shot)} is not a shot in this story (shots: ${[...byId.keys()].join(", ") || "none"})` : null)
      ?? fileReason(root, asset.file, VIDEO, "a video (.mp4, .webm, .mov, .m4v)")
      ?? sourceReason(entry?.source)
      ?? (asset.source_start < 0 ? "source_start must be 0 or more seconds" : null)
      ?? await shotReason(path.join(root, asset.file), asset, shot, format, { probe, measure });
    seenShots.add(asset.shot);
    if (!asset.reason) asset.judge = await judged(judge, { kind: "whole-shot", images: await shotFrames(root, asset, shot, still), characters: characters(bible, shot.who, root) });
    assets.push(finish(asset));
  }

  const seenPlaces = new Set();
  for (const entry of list("places")) {
    const asset = { kind: "plate", place: entry?.place ?? null, file: entry?.plate ?? null, source: entry?.source ?? null, ...(entry?.floor !== undefined ? { floor: entry.floor } : {}), ...(isObj(entry?.light) ? { light: entry.light } : {}) };
    const there = shots.filter((shot) => shot.set === asset.place);
    asset.shots = there.map((shot) => shot.id);
    asset.reason = whole
      ?? (seenPlaces.has(asset.place) ? `${HANDIN_FILE} hands in a plate for ${asset.place} twice` : null)
      ?? (!there.length ? `no shot takes place in ${JSON.stringify(asset.place)} (places: ${[...new Set(shots.map((shot) => shot.set).filter(Boolean))].join(", ") || "none"})` : null)
      ?? placeReason(there, scenes)
      ?? fileReason(root, asset.file, IMAGE, "a still (.png, .jpg, .webp)")
      ?? sourceReason(entry?.source)
      ?? (asset.floor !== undefined && !(Number(asset.floor) >= 0.3 && Number(asset.floor) <= 1) ? `floor is where the ground sits as a share of the height, 0.3–1; got ${JSON.stringify(asset.floor)}` : null)
      ?? (asset.light && asset.light.dir !== undefined && !Number.isFinite(Number(asset.light.dir)) ? `light.dir must be degrees; got ${JSON.stringify(asset.light.dir)}` : null)
      ?? await plateReason(path.join(root, asset.file), asset, format, { probe, measure });
    seenPlaces.add(asset.place);
    if (!asset.reason) asset.judge = await judged(judge, { kind: "plate", images: [path.join(root, asset.file)], characters: [], place: { ...(bible?.world ?? {}), set: asset.place } });
    assets.push(finish(asset));
  }

  return oneLook({ assets, shots, look });
}

// passed | rejected | not-checked: a judge that finds a problem rejects the asset.
function finish(asset) {
  if (asset.reason) return { ...asset, status: "rejected" };
  if (asset.judge?.status === "failed") return { ...asset, status: "rejected", reason: `the bible check found: ${asset.judge.findings.join("; ")}` };
  const { reason, ...rest } = asset;
  return { ...rest, status: "passed" };
}

/** One look per video (§5.5): which passing assets are used. */
function oneLook({ assets, shots, look }) {
  const passing = new Set(assets.filter((asset) => asset.kind === "whole-shot" && asset.status === "passed").map((asset) => asset.shot));
  const missing = shots.map((shot) => shot.id).filter((id) => !passing.has(id));
  const wholeShots = look === "mixed" ? passing.size > 0 : missing.length === 0 && shots.length > 0;
  const out = assets.map((asset) => {
    if (asset.status !== "passed") return asset;
    if (asset.kind === "whole-shot") return wholeShots ? { ...asset, status: "used" } : { ...asset, status: "unused", reason: `one look per video: ${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} no passing whole shot, so every shot is code-drawn (--look mixed uses each one that passes)` };
    if (asset.kind === "plate") {
      const drawn = asset.shots.filter((id) => !(wholeShots && passing.has(id)));
      return drawn.length ? { ...asset, status: "used", shots: drawn } : { ...asset, status: "unused", reason: "every shot there is handed in whole" };
    }
    return asset;
  });
  const rejected = out.filter((asset) => asset.status === "rejected");
  const unchecked = out.filter((asset) => asset.status === "used" && asset.judge?.status === "not-checked");
  return {
    schema: HANDIN_REPORT_SCHEMA,
    status: rejected.length ? "fallback" : unchecked.length ? "ready-for-review" : "passed",
    look: !wholeShots ? "code-drawn" : missing.length ? "mixed" : "whole-shots",
    assets: out,
    notes: [
      ...rejected.map((asset) => `${label(asset)}: rejected, ${asset.reason}`),
      ...(unchecked.length ? [`the bible check's vision judge did not run (${unchecked[0].judge.reason}); ${unchecked.length} used asset(s) need a person to compare them with the bible's sheets`] : [])
    ]
  };
}

const label = (asset) => (asset.kind === "whole-shot" ? `shot ${asset.shot}` : asset.kind === "plate" ? `plate for ${asset.place}` : `sprite cast for ${asset.character}`);
const short = (hash) => String(hash ?? "none").replace(/^sha256:/, "").slice(0, 12);

function fileReason(root, file, pattern, kind) {
  if (!text(file)) return `names no file (${kind} under assets/)`;
  if (!file.startsWith("assets/") || file.split(/[\\/]/).includes("..")) return `${file} must be under assets/`;
  if (!pattern.test(file)) return `${file} must be ${kind}`;
  if (!existsSync(path.join(root, file))) return `${file} does not exist`;
  return null;
}

function sourceReason(source) {
  if (!isObj(source) || !text(source.made_with) || !text(source.licence)) return "has no source {made_with, licence} (what made it and under what licence; it is required)";
  if (source.generated !== undefined && typeof source.generated !== "boolean") return "source.generated must be true or false";
  return null;
}

// A plate is drawn behind a cast-scene's furniture, so every shot in the place must be one that can stand on it.
function placeReason(there, scenes) {
  for (const shot of there) {
    const scene = scenes.get(shot.id);
    if (scene?.module !== "cast-scene") return `shot ${shot.id} is a ${scene?.module ?? "missing"} scene; a plate goes behind a cast-scene`;
    if (!SET_INFO[scene.params?.set]?.world) return `the ${scene.params?.set} set (shot ${shot.id}) has no furniture-only form to stand on a plate`;
    const own = ["world", "props", "screen"].find((key) => scene.params?.[key] !== undefined) ?? (scene.params?.backdrop === "room" ? "backdrop" : null);
    if (own) return `shot ${shot.id} sets params.${own}; a plate replaces the place, so that scene keeps its own`;
  }
  return null;
}

async function shotReason(file, asset, shot, format, { probe, measure }) {
  let info;
  try { info = await probe(file); } catch (error) { return `${asset.file} does not decode as video (${String(error?.message ?? error).split("\n")[0]})`; }
  if (info.width !== format.width || info.height !== format.height) return `${asset.file} is ${info.width}×${info.height}; the story is ${format.width}×${format.height}`;
  if (!(Math.abs(Number(info.fps) - format.fps) < 0.01)) return `${asset.file} runs at ${info.fps} fps; the story runs at ${format.fps}`;
  const left = info.frames - Math.round(asset.source_start * format.fps);
  if (left < shot.frames) return `${asset.file} has ${Math.max(0, left)} frame(s) from source_start ${asset.source_start} s; shot ${shot.id} needs ${shot.frames}`;
  const measured = await measure(file, { start: asset.source_start, duration: shot.seconds }).catch(() => null);
  if (measured && measured.motion < FROZEN_MOTION) return `${asset.file} is a frozen picture (motion ${measured.motion}); a whole shot must move`;
  return null;
}

async function plateReason(file, asset, format, { probe, measure }) {
  let info;
  try { info = await probe(file); } catch (error) { return `${asset.file} does not decode as an image (${String(error?.message ?? error).split("\n")[0]})`; }
  const want = format.width / format.height, got = info.width / info.height;
  if (Math.abs(got / want - 1) > PLATE_ASPECT_TOLERANCE) return `${asset.file} is ${info.width}×${info.height} (aspect ${round3(got)}); the story's is ${round3(want)} (${format.width}×${format.height})`;
  if (info.width < format.width * PLATE_MIN_WIDTH_SHARE) return `${asset.file} is ${info.width} px wide; it needs at least ${Math.ceil(format.width * PLATE_MIN_WIDTH_SHARE)} for a ${format.width} px frame`;
  // Measured as backdrop footage is; the caption legibility gate judges the rendered frame.
  const measured = await measure(file, { start: 0, duration: 0.5 }).catch(() => null);
  if (measured) asset.measured = { peak: measured.peak };
  return null;
}

// Three stills of a whole shot (first, middle, last frame) for the judge; none without one.
async function shotFrames(root, asset, shot, still) {
  const dir = path.join(root, ".launchclip", "hand-in", "frames");
  await mkdir(dir, { recursive: true });
  const times = [0, shot.seconds / 2, Math.max(0, shot.seconds - 1 / 30)].map((t) => asset.source_start + t);
  const out = [];
  for (const [i, at] of times.entries()) {
    const target = path.join(dir, `${shot.id}-${i}.png`);
    try { await still(path.join(root, asset.file), at, target); out.push(target); } catch { /* a still that will not extract leaves the judge fewer frames */ }
  }
  return out;
}

const characters = (bible, ids, root) => ids.map((id) => {
  const entry = castOf(bible).find((member) => member?.id === id);
  return { id, name: entry?.name ?? id, sheet: typeof entry?.sheet === "string" ? path.join(root, entry.sheet) : null, must_keep: entry?.must_keep ?? [], ...(entry?.flaw ? { flaw: entry.flaw } : {}) };
});

async function judged(judge, request) {
  if (!judge) return { status: "not-checked", reason: "no vision model is configured" };
  try {
    const verdict = await judge(request);
    return verdict?.ok ? { status: "passed" } : { status: "failed", findings: (verdict?.findings ?? []).map(String).filter(Boolean).slice(0, 6).concat(verdict?.findings?.length ? [] : ["it does not match the bible"]) };
  } catch (error) {
    // A judge that cannot run is not a verdict on the art.
    return { status: "not-checked", reason: `the judge failed (${String(error?.message ?? error).split("\n")[0]})` };
  }
}

/**
 * The story with every used asset in place: a whole shot becomes a clip scene
 * (same id, window and transitions), a plate goes behind its place's cast
 * scenes. Nothing else changes; a report with nothing used returns the story.
 */
export function applyHandIn(story, report) {
  const used = (report?.assets ?? []).filter((asset) => asset.status === "used");
  if (!used.length) return story;
  const shots = new Map(used.filter((asset) => asset.kind === "whole-shot").map((asset) => [asset.shot, asset]));
  const plates = new Map(used.filter((asset) => asset.kind === "plate").flatMap((asset) => asset.shots.map((id) => [id, asset])));
  return {
    ...story,
    scenes: story.scenes.map((scene) => {
      const shot = shots.get(scene.id);
      if (shot) {
        const { module: _module, params: _params, ...timing } = scene;
        return { ...timing, module: "clip", params: { media: { src: shot.file, ...(shot.source_start > 0 ? { sourceStart: shot.source_start } : {}) }, move: "none", title: `shot ${scene.id}, handed in` } };
      }
      const plate = plates.get(scene.id);
      if (plate) return { ...scene, params: { ...scene.params, plate: { src: plate.file, ...(plate.floor !== undefined ? { floor: Number(plate.floor) } : {}) }, ...(plate.light ? { light: { ...(scene.params.light ?? {}), ...plate.light } } : {}) } };
      return scene;
    })
  };
}

/**
 * A vision judge from a model that takes images (src/model_provider.js
 * runStructured): the art beside each character's reference sheet, asked
 * the bible's must_keep as a checklist, or for a plate whether it is the
 * place with nobody in it and no lettering. → judge(request) → {ok, findings}
 */
export function visionHandInJudge(client, { readImage = dataUrl } = {}) {
  return async ({ kind, images, characters: who = [], place = null }) => {
    const sheets = who.filter((member) => member.sheet && existsSync(member.sheet));
    const urls = [...await Promise.all(sheets.map((member) => readImage(member.sheet))), ...await Promise.all(images.map((file) => readImage(file)))];
    const lines = kind === "plate"
      ? [`This is a background plate for the place: ${[place?.kind, place?.time, place?.set ? `the ${place.set} set` : null].filter(Boolean).join(", ") || "the story's world"}.`, "It fails when anyone is in it, when it shows lettering, signs with words or a logo, or when it is not that place."]
      : [
        `The first ${sheets.length} image(s) are reference sheets (${sheets.map((member) => member.name).join(", ")}); the rest are frames of a handed-in shot.`,
        ...who.map((member) => `${member.name} must keep: ${[...member.must_keep, ...(member.flaw ? [`the flaw (${member.flaw}) on the same side`] : [])].join("; ") || "their look on the sheet"}.`),
        "It fails when a character drops anything they must keep (a headscarf, a mobility aid, glasses), when a skin tone is lighter or darker than the sheet, when the outfit differs, or when anyone extra is in frame. Never wave a dropped must_keep item through."
      ];
    const result = await client.runStructured({
      instructions: "You check art handed in for an animated video against its show bible. Answer the checklist strictly; when in doubt, fail it and say what differs.",
      input: lines.join("\n"),
      images: urls.map((url) => ({ url, detail: "high" })),
      schema: JUDGE_SCHEMA,
      schemaName: "launchclip_hand_in_judge",
      maxOutputTokens: 600
    });
    const value = result?.value ?? {};
    return { ok: Boolean(value.matches), findings: Array.isArray(value.findings) ? value.findings : [] };
  };
}

const JUDGE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["matches", "findings"],
  properties: { matches: { type: "boolean" }, findings: { type: "array", items: { type: "string" } } }
});

async function dataUrl(file) {
  const mime = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[path.extname(file).toLowerCase()] ?? "image/png";
  return `data:${mime};base64,${(await readFile(file)).toString("base64")}`;
}

/** Write the report to qa/hand-in.json. */
export async function writeHandInReport(project, report) {
  await mkdir(path.join(project, "qa"), { recursive: true });
  await writeFileAtomic(path.join(project, HANDIN_REPORT), `${JSON.stringify(report, null, 2)}\n`);
}

/**
 * launchclip handin check <project> [--look mixed] [--model provider:model] [--json]
 * → the report, written to qa/hand-in.json. hooks: judge, probe, measure, still.
 */
export async function handInCheckCommand(target, flags = {}, hooks = {}) {
  const project = path.resolve(String(target));
  const { readProjectStory } = await import("./story_loader.js");
  const loaded = await readProjectStory(project);
  if (!loaded) throw new Error(`No storyboard.json in ${project}`);
  let judge = hooks.judge ?? null;
  if (!judge && typeof flags.model === "string") {
    const { createMakeClient } = await import("./make/models.js");
    const made = createMakeClient(flags.model);
    if (!made.vision) throw new Error(`--model ${flags.model} does not take images, so it cannot judge hand-in art`);
    judge = visionHandInJudge(made.client);
  }
  const report = await checkHandIn(project, { story: loaded.resolved, judge, look: flags.look === "mixed" ? "mixed" : "one", ...hooks });
  if (!report) throw new Error(`No ${HANDIN_FILE} in ${project}: write the assets under assets/ and list them in ${HANDIN_FILE} (docs/ANIMATION_PIPELINE_RFC.md §5.3)`);
  await writeHandInReport(project, report);
  return { project, file: path.join(project, HANDIN_REPORT), ...report };
}

/** The report as text. */
export function formatHandIn(report) {
  const lines = [`hand-in: ${report.status}, look ${report.look}`];
  for (const asset of report.assets) lines.push(`  ${asset.status.padEnd(8)} ${label(asset)}${asset.file ? ` (${asset.file})` : ""}${asset.reason ? `: ${asset.reason}` : ""}${asset.judge?.status === "not-checked" ? " [bible check not run]" : ""}`);
  for (const note of report.notes.filter((line) => !line.includes(": rejected, "))) lines.push(`  note: ${note}`);
  return `${lines.join("\n")}\n`;
}

// The animatic contract (docs/ANIMATION_PIPELINE_RFC.md §4.4): ANIMATIC.json.
//
// The animatic is the whole story drawn by the rig at draft quality, with the
// real voice and captions: `launchclip finish <project> --animatic`, written
// to renders/animatic.mp4. finish is the writer (src/finish.js calls
// writeAnimatic after its gates); the staging review (src/make/critic.js
// reviewAnimatic) fills `review`.
//
//   {schema: "launchclip.animatic.v1", story_hash, bible_hash, video,
//    renderer, fps, duration,
//    shots: [{id, start, end, frames, first_frame, last_frame, segment, segments}],
//    gates: {<gate>: "passed"|"failed"|"pending"|…}, gates_failed: [names],
//    review: {verdict: "ship"|"repair"|"replan"|null, file}}
//
// - story_hash is the hash of storyboard.json as parsed; bible_hash is the
//   frozen BIBLE.json's own hash (null with no bible). readAnimatic() says
//   whether the file still matches both, so a rerun can reuse the animatic.
// - A shot's `segment` is the render segment that holds most of it
//   ("<id>:<hash>"); `segments` lists every segment that shows it. Both are
//   null for a renderer without frame ranges (it renders the whole video).
// - `gates` are finish's own, minus `critic` (the review stands in for it).
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { hashValue } from "@launchclip/core/render-segments.mjs";
import { shotList } from "./story_shots.js";

export const ANIMATIC_SCHEMA = "launchclip.animatic.v1";
export const ANIMATIC_FILE = "ANIMATIC.json";
export const ANIMATIC_VIDEO = "renders/animatic.mp4";
export const ANIMATIC_REVIEW_FILE = "qa/animatic-critic.json";

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

/** What an animatic is made from: {story_hash, bible_hash} (each null when its file is missing). */
export async function animaticInputs(project) {
  const story = await readJson(path.join(project, "storyboard.json"));
  const bible = await readJson(path.join(project, "BIBLE.json"));
  return { story_hash: story ? hashValue(story) : null, bible_hash: typeof bible?.hash === "string" ? bible.hash : null };
}

/**
 * The animatic's shots: the shot list (src/story_shots.js), each with the
 * render segments that show it. segments: the render stage's
 * `details.segments` (its `plan`), or null.
 */
export function animaticShots(resolved, { map = null, words = [], script = null, segments = null } = {}) {
  const plan = segments?.mode === "segments" && Array.isArray(segments.plan) ? segments.plan : [];
  return shotList(resolved, { map, words, script }).shots.map((shot) => {
    const showing = plan.filter((entry) => entry.scenes?.includes(shot.id));
    const overlap = (entry) => Math.max(0, Math.min(entry.frames[1], shot.last_frame + 1) - Math.max(entry.frames[0], shot.first_frame));
    const main = [...showing].sort((a, b) => overlap(b) - overlap(a))[0] ?? null;
    return {
      id: shot.id,
      start: shot.start,
      end: shot.end,
      frames: shot.frames,
      first_frame: shot.first_frame,
      last_frame: shot.last_frame,
      who: shot.who,
      segment: main ? `${main.id}:${main.hash}` : null,
      segments: showing.length ? showing.map((entry) => `${entry.id}:${entry.hash}`) : null
    };
  });
}

/**
 * Write ANIMATIC.json. gates: finish's gates ({name: {status}}); an earlier
 * review is kept while the story and the bible are the ones it reviewed.
 * → {file, animatic}
 */
export async function writeAnimatic(project, { resolved, map = null, words = [], script = null, segments = null, gates = {}, video = ANIMATIC_VIDEO, renderer = null } = {}) {
  const inputs = await animaticInputs(project);
  const previous = await readJson(path.join(project, ANIMATIC_FILE));
  const sameInputs = previous?.story_hash === inputs.story_hash && previous?.bible_hash === inputs.bible_hash;
  const statuses = Object.fromEntries(Object.entries(gates ?? {}).filter(([name]) => name !== "critic").map(([name, gate]) => [name, gate?.status ?? "unknown"]));
  const animatic = {
    schema: ANIMATIC_SCHEMA,
    ...inputs,
    video,
    renderer,
    fps: Number(resolved?.resolved?.fps ?? resolved?.format?.fps ?? 30),
    duration: Number(resolved?.resolved?.duration ?? resolved?.format?.duration ?? 0),
    shots: animaticShots(resolved, { map, words, script, segments }),
    gates: statuses,
    gates_failed: Object.entries(statuses).filter(([, status]) => status === "failed").map(([name]) => name),
    review: sameInputs && previous?.review?.verdict ? previous.review : { verdict: null, file: null }
  };
  const file = path.join(project, ANIMATIC_FILE);
  await writeFile(file, `${JSON.stringify(animatic, null, 2)}\n`);
  return { file, animatic };
}

/**
 * Read ANIMATIC.json and say whether it is still the animatic of this
 * storyboard and bible: → {animatic, file, fresh, reasons}. `animatic` is
 * null when there is none.
 */
export async function readAnimatic(project) {
  const file = path.join(project, ANIMATIC_FILE);
  const animatic = await readJson(file);
  if (!animatic || animatic.schema !== ANIMATIC_SCHEMA) return { animatic: null, file, fresh: false, reasons: [`${ANIMATIC_FILE} is missing or is not ${ANIMATIC_SCHEMA}`] };
  const inputs = await animaticInputs(project);
  const reasons = [];
  if (animatic.story_hash !== inputs.story_hash) reasons.push("storyboard.json changed since the animatic was rendered");
  if (animatic.bible_hash !== inputs.bible_hash) reasons.push("BIBLE.json changed since the animatic was rendered");
  if (!existsSync(path.join(project, animatic.video ?? ANIMATIC_VIDEO))) reasons.push(`${animatic.video ?? ANIMATIC_VIDEO} is missing`);
  return { animatic, file, fresh: reasons.length === 0, reasons };
}

/** Record the staging review's verdict in ANIMATIC.json. → the updated animatic, or null with no animatic. */
export async function recordAnimaticReview(project, { verdict, file = ANIMATIC_REVIEW_FILE } = {}) {
  const target = path.join(project, ANIMATIC_FILE);
  const animatic = await readJson(target);
  if (!animatic) return null;
  animatic.review = { verdict: verdict ?? null, file: verdict ? file : null };
  await writeFile(target, `${JSON.stringify(animatic, null, 2)}\n`);
  return animatic;
}

/** Whether an animatic may go on to the delivery render: no gate failed and the review said ship. */
export function animaticApproved(animatic) {
  return Boolean(animatic) && !(animatic.gates_failed ?? []).length && animatic.review?.verdict === "ship";
}

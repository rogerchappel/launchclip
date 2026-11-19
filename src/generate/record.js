// Recording a shot an agent generated with its own tool (docs/GENERATED_FOOTAGE_RFC.md
// §5 provider class 4, the skill path). LaunchClip never sees the agent's
// connection: the agent reads `generate brief --json`, makes the file, and
// hands it in here.
//
//   recordShot(project, {shot, step, file, madeWith, licence, cost?, seed?, briefHash?, verdict?, reason?})
//   → {entry (the ledger line), shot (the asset-provider answer, accepted footage only), placed}
//
// The file is copied under assets/shots/generated/<request id>/, one ledger line
// is appended (no cost → cost_unknown: true), and an accepted footage shot whose
// brief needs no further step is written into storyboard.json by resolveShots,
// as make --generate places it. A brief hash that is not the current brief's is refused.
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { backdropRequests, pathValue, resolveShots, shotRequests, withPath } from "../asset_provider.js";
import { loadWords } from "../finish.js";
import { projectBriefs } from "./brief.js";
import { GENERATED_DIR, parseBudget } from "./generator.js";
import { MAX_ATTEMPTS, appendLedger, nextAttempt } from "./ledger.js";

export const AGENT_PROVIDER = "agent";
const EXTENSIONS = { image: /\.(jpe?g|png|webp)$/i, video: /\.(mp4|webm|mov)$/i };

export async function recordShot(project, { shot, step, file, madeWith, licence, cost = null, seed = null, briefHash = null, verdict = "accepted", reason = null }) {
  if (!shot) throw new Error("generate record needs --shot <id> (a request id from generate brief, or its scene id)");
  if (!EXTENSIONS[step]) throw new Error(`generate record needs --step image or --step video; got ${step}`);
  if (!file || !existsSync(file)) throw new Error(`generate record needs --file <path> that exists; got ${file}`);
  if (!EXTENSIONS[step].test(file)) throw new Error(`--file for the ${step} step must be ${step === "image" ? ".jpg, .png or .webp" : ".mp4, .webm or .mov"}; got ${path.basename(file)}`);
  if (!madeWith) throw new Error("generate record needs --made-with <tool/model>");
  if (!licence) throw new Error("generate record needs --licence <text>: the generation tool's output terms, never guessed");
  if (!["accepted", "rejected"].includes(verdict)) throw new Error(`--verdict must be accepted or rejected; got ${verdict}`);
  if (seed != null && !Number.isInteger(Number(seed))) throw new Error(`--seed must be a whole number; got ${seed}`);
  const spent = cost == null ? null : parseBudget(cost, "--cost");
  if (spent && Object.keys(spent).length !== 1) throw new Error(`--cost is one amount in one unit (0.4usd or 20credits); got ${cost}`);

  const matches = (await projectBriefs(project)).filter(({ request }) => request.id === shot || request.scene_id === shot);
  if (!matches.length) throw new Error(`generate record: no shot request ${shot} in ${project}`);
  if (matches.length > 1) throw new Error(`generate record: scene ${shot} has ${matches.length} shot requests; pass the request id (${matches.map(({ request }) => request.id).join(", ")})`);
  const [{ request, brief, reason: refused }] = matches;
  if (request.role === "story" || request.role === "plate") throw new Error(`generate record: ${request.id} is a story ${request.role === "plate" ? "plate" : "shot"}; story shots are handed in through HANDIN.json, which generate record does not write yet`);
  if (!brief) throw new Error(`generate record: ${request.id} is not generated (${refused})`);
  if (briefHash && briefHash !== brief.brief_hash) throw new Error(`generate record: --brief-hash ${briefHash} is not the current brief for ${request.id} (${brief.brief_hash}); the storyboard or narration changed since, so run generate brief again and regenerate`);
  if (!brief.steps.includes(step)) throw new Error(`generate record: ${request.id} is a still; its brief has no ${step} step`);

  const attempt = await nextAttempt(project, request.id, step);
  if (attempt == null) throw new Error(`generate record: ${request.id} already has ${MAX_ATTEMPTS} ${step} attempts; the shot needs simplifying, not another try`);
  const rel = path.join(GENERATED_DIR, request.id, `${step}-${AGENT_PROVIDER}-${attempt}${path.extname(file).toLowerCase()}`);
  await mkdir(path.dirname(path.join(project, rel)), { recursive: true });
  await copyFile(file, path.join(project, rel));
  const entry = await appendLedger(project, {
    shot: request.id, step, tier: "final", attempt, provider: AGENT_PROVIDER, model: madeWith,
    seed: seed == null ? null : Number(seed), brief_hash: brief.brief_hash,
    // No cost reported is unknown spend, not free.
    cost: spent ? { amount: Object.values(spent)[0], unit: Object.keys(spent)[0] } : { amount: 0, unit: "usd" },
    ...(spent ? {} : { cost_unknown: true }),
    file: rel, licence, verdict, ...(reason ? { reason } : {})
  });

  // The keyframe of a video brief is a draft: the storyboard waits for the clip.
  const last = brief.steps.at(-1) === step;
  if (verdict !== "accepted" || !last) return { entry, shot: null, placed: false };
  const answer = {
    kind: step, src: rel.split(path.sep).join("/"),
    source: { made_with: madeWith, licence, generated: true, provider: AGENT_PROVIDER, model: madeWith, brief_hash: brief.brief_hash },
    ...(step === "video" ? { sourceStart: brief.video.pad_seconds } : {})
  };
  await placeInStoryboard(project, request.id, answer);
  return { entry, shot: answer, placed: true };
}

// resolveShots answers the one request and leaves every other request as it was
// (a missed card slot or backdrop would otherwise be dropped from the scene).
async function placeInStoryboard(project, id, answer) {
  const file = path.join(project, "storyboard.json");
  const story = JSON.parse(await readFile(file, "utf8"));
  const words = (await loadWords(project, story)) ?? [];
  const { storyboard: resolved, shots } = await resolveShots(story, { assets: { findShot: (request) => (request.id === id ? answer : null) }, words, project });
  const placed = shots.find((entry) => entry.request_id === id);
  if (!placed) throw new Error(`generate record: ${id} could not be placed in the storyboard`);
  const slot = placed.slot ?? "media";
  const index = story.scenes.findIndex((scene) => (scene.id ?? null) === placed.scene_id);
  let scene = resolved.scenes[index];
  const original = story.scenes[index];
  for (const { index: at, slot: other } of shotRequests(story)) if (at === index && other !== slot) scene = { ...scene, params: withPath(scene.params, other, pathValue(original.params, other)) };
  if (slot !== "backdrop" && backdropRequests(story).some(({ index: at }) => at === index)) scene = { ...scene, backdrop: original.backdrop };
  story.scenes[index] = scene;
  await writeFile(file, `${JSON.stringify(story, null, 2)}\n`);
}

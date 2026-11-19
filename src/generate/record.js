// The skill path (docs/GENERATED_FOOTAGE_RFC.md §5 provider class 4): an
// agent generates with its own tool, and LaunchClip never sees the connection.
// The agent reads `generate brief --json` and, per call, runs the same gates
// make --generate runs in-process:
//
//   allowCall(project, {shot, step, quote?, budget?, daily?, maxGenerations?})
//     → {ok, reasons, attempt}: the shared spend gate (ledger.js spendGate), the
//     attempt cap and the reuse of an accepted file, before any paid call.
//   checkKeyframe(project, {shot, file, model}) → {ok, reason, change}: the same
//     keyframe check (footage: visionKeyframeCheck; story shot or plate: the
//     hand-in judge against the bible).
//   recordShot(project, {shot, step, file, madeWith, licence, cost?, seed?, briefHash?, verdict?, reason?})
//     → {entry (the ledger line), shot, placed}
//
// recordShot copies the file under assets/shots/generated/<request id>/ and
// appends a ledger line (no cost → cost_unknown: true). An accepted last step
// is placed as make --generate places it: a footage shot into storyboard.json
// (resolveShots), a story shot or plate into HANDIN.json (story.js
// writeHandIn), so the hand-in path checks it. A brief hash that is not the
// current brief's is refused.
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { backdropRequests, pathValue, resolveShots, shotRequests, withPath } from "../asset_provider.js";
import { loadWords } from "../finish.js";
import { projectBriefs } from "./brief.js";
import { GENERATED_DIR, parseBudget, visionKeyframeCheck } from "./generator.js";
import { MAX_ATTEMPTS, appendLedger, nextAttempt, readLedger, spendGate } from "./ledger.js";
import { keyframeCheck, writeHandIn } from "./story.js";

export const AGENT_PROVIDER = "agent";
const EXTENSIONS = { image: /\.(jpe?g|png|webp)$/i, video: /\.(mp4|webm|mov)$/i };

export async function recordShot(project, { shot, step, file, madeWith, licence, cost = null, seed = null, briefHash = null, verdict = "accepted", reason = null, attempt: round = null, candidate = null }, hooks = {}) {
  if (!EXTENSIONS[step]) throw new Error(`generate record needs --step image or --step video; got ${step}`);
  if (!file || !existsSync(file)) throw new Error(`generate record needs --file <path> that exists; got ${file}`);
  if (!EXTENSIONS[step].test(file)) throw new Error(`--file for the ${step} step must be ${step === "image" ? ".jpg, .png or .webp" : ".mp4, .webm or .mov"}; got ${path.basename(file)}`);
  if (!madeWith) throw new Error("generate record needs --made-with <tool/model>");
  if (!licence) throw new Error("generate record needs --licence <text>: the generation tool's output terms, never guessed");
  if (!["accepted", "rejected"].includes(verdict)) throw new Error(`--verdict must be accepted or rejected; got ${verdict}`);
  if (seed != null && !Number.isInteger(Number(seed))) throw new Error(`--seed must be a whole number; got ${seed}`);
  const spent = cost == null ? null : parseBudget(cost, "--cost");
  if (spent && Object.keys(spent).length !== 1) throw new Error(`--cost is one amount in one unit (0.4usd or 20credits); got ${cost}`);

  const found = await findBrief(project, shot, step, "generate record", hooks);
  const { request, brief } = found;
  if (briefHash && briefHash !== brief.brief_hash) throw new Error(`generate record: --brief-hash ${briefHash} is not the current brief for ${request.id} (${brief.brief_hash}); the storyboard or narration changed since, so run generate brief again and regenerate`);

  // Keyframe candidates of one round share the attempt generate allow gave (--attempt), told apart by --candidate.
  const next = await nextAttempt(project, request.id, step);
  const attempt = round == null ? next : Number(round);
  if (round != null && !(Number.isInteger(attempt) && attempt >= 1 && attempt <= (next ?? MAX_ATTEMPTS))) throw new Error(`--attempt must be the round generate allow gave, from 1 to ${next ?? MAX_ATTEMPTS}; got ${round}`);
  if (attempt == null) throw new Error(`generate record: ${request.id} already has ${MAX_ATTEMPTS} ${step} attempts; the shot needs simplifying, not another try`);
  const pick = candidate == null ? null : Number(candidate);
  if (pick != null && !(Number.isInteger(pick) && pick >= 1)) throw new Error(`--candidate must be a whole number from 1; got ${candidate}`);
  const rel = path.join(GENERATED_DIR, request.id, `${step}-${AGENT_PROVIDER}-${attempt}${pick ? `-c${pick}` : ""}${path.extname(file).toLowerCase()}`);
  await mkdir(path.dirname(path.join(project, rel)), { recursive: true });
  await copyFile(file, path.join(project, rel));
  const entry = await appendLedger(project, {
    shot: request.id, step, tier: "final", attempt, ...(pick ? { candidate: pick } : {}), provider: AGENT_PROVIDER, model: madeWith,
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
  if (request.role === "story" || request.role === "plate") await placeInHandIn(project, found, answer);
  else await placeInStoryboard(project, request.id, answer);
  return { entry, shot: answer, placed: true };
}

/**
 * Before a paid call: may the agent make this one? The same gate as make
 * --generate (spendGate), with the agent's quote: "unknown" (or none) when its
 * tool gives no price, which then needs maxGenerations, as an unpriced provider
 * does in make. A priced call needs a budget: the amount the user agreed to.
 * A step already accepted for the current brief is refused, so a re-run
 * reuses it instead of paying again.
 */
export async function allowCall(project, { shot, step, quote = null, budget = null, daily = null, maxGenerations = null } = {}, hooks = {}) {
  const { request, brief } = await findBrief(project, shot, step, "generate allow", hooks);
  const done = (await acceptedSteps(project, brief))[step];
  if (done) return { ok: false, shot: request.id, step, reasons: [`${step} is already accepted for this brief (${done.file}); reuse it`], accepted: done.file };
  const attempt = await nextAttempt(project, request.id, step);
  if (attempt == null) return { ok: false, shot: request.id, step, reasons: [`${MAX_ATTEMPTS} ${step} attempts were made; the shot needs simplifying, not another try`] };
  const asked = parseQuote(quote);
  const limits = parseBudget(budget);
  if (asked.amount != null && !limits) return { ok: false, shot: request.id, step, attempt, reasons: ["a priced call needs --budget: the amount the user agreed to spend"] };
  const { parseMaxGenerations } = await import("../make/generate.js");
  const gate = await spendGate({ project, provider: AGENT_PROVIDER, quote: asked, budget: limits ?? {}, daily: parseBudget(daily, "--budget-daily"), maxCalls: parseMaxGenerations(maxGenerations) });
  return { ok: gate.ok, shot: request.id, step, attempt, quote: asked, reasons: gate.reasons };
}

/**
 * The keyframe check make --generate runs, on a still the agent made: a
 * footage shot against its `shows`, a story shot or plate against the bible.
 * model is a provider:model route that takes images; hooks.client stands in
 * for it, hooks.frame for ffmpeg (as in projectBriefs).
 */
export async function checkKeyframe(project, { shot, file, model = null, audience = null, concepts = null } = {}, hooks = {}) {
  // Several candidates: --file a.png,b.png,c.png are ranked in one look, as make --keyframe-candidates does.
  const files = String(file ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!files.length || files.some((entry) => !existsSync(entry))) throw new Error(`generate check needs --file <path>[,<path>...] that exist; got ${file}`);
  const found = await findBrief(project, shot, "image", "generate check", hooks);
  let client = hooks.client ?? null;
  if (!client) {
    if (typeof model !== "string") throw new Error("generate check needs --model <provider:model>, a model that takes images");
    const { createMakeClient } = await import("../make/models.js");
    const made = createMakeClient(model);
    if (!made.vision) throw new Error(`--model ${model} does not take images, so it cannot check a keyframe`);
    client = made.client;
  }
  const { request, brief } = found;
  let one;
  if (request.role !== "story" && request.role !== "plate") {
    const vision = visionKeyframeCheck(client);
    // --concepts "a|b|c": each file's own concept, in --file order; --audience: who the video is for.
    const each = typeof concepts === "string" ? concepts.split("|").map((entry) => entry.trim()) : [];
    if (files.length > 1) return { shot: request.id, ...ranked(await vision.rank({ files, brief, request, ...(each.some(Boolean) ? { concepts: files.map((_, i) => each[i] || null) } : {}), ...(typeof audience === "string" && audience.trim() ? { audience: audience.trim() } : {}) })) };
    one = (entry) => vision({ file: entry, brief, request });
  } else {
    const { visionHandInJudge } = await import("../hand_in.js");
    const root = path.resolve(project);
    const judge = keyframeCheck(visionHandInJudge(await Promise.resolve(client)), await readBible(root), root);
    one = (entry) => judge({ file: entry, request: { role: request.role, who: found.shot?.who ?? [] } });
  }
  if (files.length === 1) return { shot: request.id, reason: null, change: null, ...(await one(files[0])) };
  // No ranking for the bible check: candidates are judged in turn and the first that passes is chosen.
  const verdicts = [];
  for (const entry of files) {
    const verdict = await one(entry);
    verdicts.push(verdict);
    if (verdict.ok) return { shot: request.id, ...ranked({ best: verdicts.length - 1, verdicts, change: null }) };
  }
  return { shot: request.id, ...ranked({ best: null, verdicts, change: verdicts.at(-1)?.change ?? null }) };
}

// The ranking as the CLI reports it: candidates numbered from 1, in --file order.
function ranked({ best, verdicts, change }) {
  return { ok: best != null, chosen: best == null ? null : best + 1, candidates: verdicts.map((verdict, i) => ({ candidate: i + 1, ok: Boolean(verdict?.ok), ...(verdict?.score != null ? { score: verdict.score } : {}), reason: verdict?.reason ?? null })), reason: best == null ? (verdicts.find((verdict) => verdict?.reason)?.reason ?? "no candidate passes") : null, change };
}

/** The steps already accepted for this brief, any provider, whose file is still there: {image, video}. */
export async function acceptedSteps(project, brief) {
  const entries = (await readLedger(project)).reverse();
  const find = (step) => entries.find((entry) => entry.verdict === "accepted" && entry.step === step && entry.brief_hash === brief.brief_hash && entry.file && existsSync(path.resolve(project, entry.file))) ?? null;
  return { image: find("image"), video: brief.video ? find("video") : null };
}

// One request by id (or its scene id), with a brief that has this step.
async function findBrief(project, shot, step, command, hooks = {}) {
  if (!shot) throw new Error(`${command} needs --shot <id> (a request id from generate brief, or its scene id)`);
  if (!EXTENSIONS[step]) throw new Error(`${command} needs --step image or --step video; got ${step}`);
  const matches = (await projectBriefs(project, hooks)).filter(({ request }) => request.id === shot || request.scene_id === shot);
  if (!matches.length) throw new Error(`${command}: no shot request ${shot} in ${project}`);
  if (matches.length > 1) throw new Error(`${command}: scene ${shot} has ${matches.length} shot requests; pass the request id (${matches.map(({ request }) => request.id).join(", ")})`);
  const [found] = matches;
  if (!found.brief) throw new Error(`${command}: ${found.request.id} is not generated (${found.reason})`);
  if (!found.brief.steps.includes(step)) throw new Error(`${command}: ${found.request.id} is a still; its brief has no ${step} step`);
  return found;
}

// "0.4usd", "20credits", "unknown" or nothing → {amount, unit}; amount null is no price known.
function parseQuote(value) {
  if (value == null || value === "" || String(value).toLowerCase() === "unknown") return { amount: null, unit: "usd" };
  const parsed = parseBudget(value, "--quote");
  if (Object.keys(parsed).length !== 1) throw new Error(`--quote is one amount in one unit (0.4usd or 20credits) or unknown; got ${value}`);
  const [[unit, amount]] = Object.entries(parsed);
  return { amount, unit };
}

async function readBible(root) {
  const { BIBLE_FILE } = await import("@launchclip/core/bible.mjs");
  return JSON.parse(await readFile(path.join(root, BIBLE_FILE), "utf8"));
}

// A story shot's clip or a plate's still into HANDIN.json, as finish --generate writes it.
async function placeInHandIn(project, found, answer) {
  const root = path.resolve(project);
  const made = { file: path.join(root, answer.src), source: answer.source, sourceStart: answer.sourceStart ?? 0 };
  const plate = found.request.role === "plate";
  await writeHandIn(root, await readBible(root), { plates: plate ? [[found, made]] : [], shots: plate ? [] : [[found, made]], attempted: [found] });
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

// Generated story shots and plates (docs/GENERATED_FOOTAGE_RFC.md §3, §4.1,
// §6): the footage generator answers the story-shot and plate briefs of a
// project with a frozen bible and an animatic, and writes what it made into
// HANDIN.json with source {made_with, licence, generated: true}. From there it
// is the hand-in path (src/hand_in.js): checked, used under one look per
// video, or fallen back to code-drawn.
//
//   finish --generate <provider>[:<model>] [--generate-draft-video …] [--budget …]
//          [--stop-after drafts | --approve drafts]
//
// Drafts, then finals. Every keyframe is made and checked against the bible
// first (the hand-in judge on the still); with a draft video model the drafts
// are low-cost clips too. --stop-after drafts ends there (awaiting-approval;
// HANDIN.json names the plates and any draft clips, so handin check can look at
// them); --approve drafts, or a yes when attended, makes the finals from the
// same keyframes. Plates are made once per place (image only) and reused.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BIBLE_FILE } from "@launchclip/core/bible.mjs";
import { HANDIN_FILE, HANDIN_SCHEMA, visionHandInJudge } from "../hand_in.js";
import { writeFileAtomic } from "../atomic_write.js";
import { storyBriefs } from "./brief.js";
import { createGenerator, createProviders, generateSpecs, parseBudget } from "./generator.js";

export const DRAFTS_STOP = "drafts";

const castOf = (bible) => (Array.isArray(bible?.cast) ? bible.cast : Array.isArray(bible?.cast?.characters) ? bible.cast.characters : []);

/**
 * Generate the story's shots and plates into HANDIN.json.
 * options: image, video (provider adapters), draft (the video provider has a
 * draft model), budget, daily, maxCalls, stopAfter, approved (--approve
 * drafts), ask(question) → boolean (attended) | null, judge (hand-in judge) | null,
 * notice, hooks (storyBriefs' frame).
 * → {status: "generated" | "awaiting-approval", shots, plates, quotes, stopped, notes}
 */
export async function generateStoryAssets(project, { image, video = null, draft = false, budget = null, daily = null, maxCalls = null, stopAfter = null, approved = false, ask = null, judge = null, notice = () => {}, hooks = {} } = {}) {
  const root = path.resolve(project);
  if (!existsSync(path.join(root, BIBLE_FILE))) throw new Error(`generating story shots needs a frozen show bible (${BIBLE_FILE}); make one with launchclip bible freeze`);
  const story = JSON.parse(await readFile(path.join(root, "storyboard.json"), "utf8"));
  const bible = JSON.parse(await readFile(path.join(root, BIBLE_FILE), "utf8"));
  const entries = await storyBriefs(root, story, hooks);
  if (!entries.length) throw new Error("generating story shots needs the animatic (ANIMATIC.json): run launchclip finish --animatic first, or make --animation");
  const notes = [];
  const say = (line) => { notes.push(line); notice(`generate: ${line}`); };
  for (const entry of entries) if (entry.reason) say(`${entry.request.id}: not generated, ${entry.reason}; it is code-drawn`);
  const plates = entries.filter((entry) => entry.request.role === "plate" && entry.place && entry.brief);
  const shots = entries.filter((entry) => entry.request.role === "story" && entry.brief);
  const check = judge ? keyframeCheck(judge, bible, root) : null;
  const quotes = [];
  let stopped = null;

  // One pass of the generator over the requests at one tier; → Map id → shot | null.
  const pass = async (tier, requests) => {
    const generator = createGenerator({ project: root, image, video, budget, daily, tier, maxCalls, check, approve: ask, notice, fps: Number(story.format?.fps) || undefined });
    try {
      const answers = await Promise.all(requests.map((request) => generator.findShot(request)));
      const report = generator.report();
      quotes.push(...report.quotes);
      notes.push(...report.notes);
      stopped ??= report.stopped;
      return new Map(requests.map((request, i) => [request.id, answers[i]]));
    } finally {
      await generator.close?.();
    }
  };
  const request = (entry, keyframeOnly) => ({ id: entry.request.id, role: entry.request.role, who: entry.shot?.who ?? [], storyBrief: entry.brief, keyframeOnly });

  // Drafts: every keyframe (and, with a draft model, a draft clip); plates are image only.
  const drafts = await pass("draft", [...plates.map((entry) => request(entry, true)), ...shots.map((entry) => request(entry, !draft))]);
  const madePlates = plates.filter((entry) => drafts.get(entry.request.id));
  const drafted = shots.filter((entry) => drafts.get(entry.request.id));
  let go = approved;
  if (!go && String(stopAfter ?? "").toLowerCase() !== DRAFTS_STOP && drafted.length) {
    // Attended, a person looks at the drafts; headless goes on to the finals unless --stop-after drafts (as at the bible and the animatic).
    go = ask ? await ask(`drafts: ${drafted.length} keyframe(s)${draft ? " and draft clip(s)" : ""} are in ${path.join(root, "assets", "shots", "generated")}. Make the finals?`) : true;
  }
  if (!go || !drafted.length) {
    const clips = draft ? drafted.map((entry) => [entry, drafts.get(entry.request.id)]).filter(([, shot]) => shot.kind === "video") : [];
    await writeHandIn(root, bible, { plates: madePlates.map((entry) => [entry, drafts.get(entry.request.id)]), shots: clips, attempted: [...plates, ...shots] });
    if (!drafted.length) return { status: "generated", shots: 0, plates: madePlates.length, quotes, stopped, notes };
    say(`stopped after the drafts: look at them, then run again with --approve drafts`);
    return { status: "awaiting-approval", stopped_after: DRAFTS_STOP, shots: clips.length, drafts: drafted.length, plates: madePlates.length, quotes, stopped, notes };
  }

  // Finals: only approved drafts, from the same keyframes (the image step is reused across tiers).
  const finals = await pass("final", drafted.map((entry) => request(entry, false)));
  const made = drafted.map((entry) => [entry, finals.get(entry.request.id)]).filter(([, shot]) => shot?.kind === "video");
  await writeHandIn(root, bible, { plates: madePlates.map((entry) => [entry, drafts.get(entry.request.id)]), shots: made, attempted: [...plates, ...shots] });
  return { status: "generated", shots: made.length, plates: madePlates.length, quotes, stopped, notes };
}

// The keyframe checked against the bible: the hand-in judge on the still, as on a handed-in shot or plate.
export function keyframeCheck(judge, bible, root) {
  return async ({ file, request }) => {
    const plate = request.role === "plate";
    const characters = (plate ? [] : request.who ?? []).map((id) => {
      const entry = castOf(bible).find((member) => member.id === id);
      return { id, name: entry?.name ?? id, sheet: typeof entry?.sheet === "string" ? path.join(root, entry.sheet) : null, must_keep: entry?.must_keep ?? [], ...(entry?.flaw ? { flaw: entry.flaw } : {}) };
    });
    const verdict = await judge({ kind: plate ? "plate" : "whole-shot", images: [file], characters, place: bible?.world ?? null });
    const findings = (verdict?.findings ?? []).map(String).filter(Boolean);
    return verdict?.ok ? { ok: true } : { ok: false, reason: findings.join("; ") || "it does not match the bible", change: findings[0] ? `Fix this: ${findings[0]}.` : null };
  };
}

// HANDIN.json: the generated entries replace any for the same shot or place this run tried; the rest are kept.
export async function writeHandIn(root, bible, { plates, shots, attempted }) {
  const file = path.join(root, HANDIN_FILE);
  const existing = existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : {};
  const triedShots = new Set(attempted.filter((entry) => entry.request.role === "story").map((entry) => entry.shot.id));
  const triedPlaces = new Set(attempted.filter((entry) => entry.request.role === "plate").map((entry) => entry.place));
  const rel = (shot) => path.relative(root, shot.file).split(path.sep).join("/");
  const source = (shot) => ({ made_with: shot.source.made_with, licence: shot.source.licence, generated: true });
  const manifest = {
    ...existing,
    schema: HANDIN_SCHEMA,
    bible_hash: bible.hash ?? null,
    places: [...(existing.places ?? []).filter((entry) => !triedPlaces.has(entry?.place)), ...plates.map(([entry, shot]) => ({ place: entry.place, plate: rel(shot), source: source(shot) }))],
    shots: [...(existing.shots ?? []).filter((entry) => !triedShots.has(entry?.shot)), ...shots.map(([entry, shot]) => ({ shot: entry.shot.id, clip: rel(shot), source_start: shot.sourceStart ?? 0, source: source(shot) }))]
  };
  await writeFileAtomic(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * finish's --generate: the providers from the flags (or adapters.generateProviders),
 * the hand-in judge when finish has one, a person to ask when attended.
 * → generateStoryAssets()'s result, or null when no --generate flag is set.
 */
export async function finishGenerate(project, options, adapters = {}) {
  const specs = generateSpecs({ generate: options.generate, image: options.generateImage, video: options.generateVideo, draftVideo: options.generateDraftVideo });
  if (!specs) return null;
  const notice = adapters.notice ?? (() => {});
  const providers = adapters.generateProviders ?? await createProviders(specs, { env: adapters.env ?? process.env, notice, cwd: project });
  const { parseMaxGenerations } = await import("../make/generate.js");
  const attended = Boolean(adapters.ask) || Boolean(process.stdin.isTTY && process.stderr.isTTY);
  const { askYesNo } = attended && !adapters.ask ? await import("../demo/autopilot.js") : {};
  const approvals = String(options.approve ?? "").split(",").map((value) => value.trim().toLowerCase());
  return generateStoryAssets(project, {
    image: providers.image,
    video: providers.video,
    draft: Boolean(specs.draftVideo),
    budget: parseBudget(options.budget),
    daily: parseBudget(options.budgetDaily, "--budget-daily"),
    maxCalls: parseMaxGenerations(options.maxGenerations),
    stopAfter: options.stopAfter ?? null,
    approved: approvals.includes(DRAFTS_STOP),
    ask: attended ? (question) => (adapters.ask ?? askYesNo)(question) : null,
    judge: adapters.handInJudge ?? (adapters.handInClient ? visionHandInJudge(adapters.handInClient) : null),
    notice,
    hooks: adapters.generateHooks ?? {}
  });
}

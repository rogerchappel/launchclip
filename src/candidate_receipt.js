// Rendered candidates (`launchclip finish <candidate-project> --candidate <id>`):
// a cheap draft render that makes no paid calls, recorded into the
// rendered-candidate receipt cinematic-check reads
// (qa/rendered-candidates.json, launchclip.subscription-rendered-candidates.v2).
//
// Each candidate run copies its encoded clip and three lifecycle frames
// (entry, peak, settle; extracted by exact frame number) into
// <into>/qa/rendered-candidates/<id>/ and upserts the candidate into its
// comparison with artifact hashes and a render ID. Scores, the winner and the
// rationale are judged from the pixels afterwards (the critic step); until
// they are filled in, cinematic-check reports the receipt as incomplete.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { SUBSCRIPTION_CANDIDATE_RECEIPT_VERSION } from "./cinematic_evidence.js";

const run = promisify(execFile);

export const CANDIDATE_RECEIPT = "qa/rendered-candidates.json";
export const CANDIDATE_DIR = "qa/rendered-candidates";
export const CANDIDATE_OUTPUT = "renders/candidate.mp4";
export const CANDIDATE_SCORE_TEMPLATE = Object.freeze({
  scroll_stop: null, promise_or_proof_clarity: null, mobile_hierarchy: null, art_direction_specificity: null, depth_materiality: null,
  temporal_development: null, continuity: null, velocity_blur_shape: null, crisp_settle: null, implementation_feasibility: null
});
// Voice providers that cost nothing to run (local or offline).
export const FREE_VOICE_PROVIDERS = Object.freeze(["kokoro", "supplied", "test"]);
// Music providers a candidate may use (no generation call).
export const FREE_MUSIC_CHOICES = Object.freeze(["synth", "none", "file"]);

/**
 * The paid-call-free audio for a candidate render.
 * → {voice: provider override | undefined, music: flag, notes: [..]}
 * voice: the story's own provider when it is free or its take is cached
 * (launchclip voice / an earlier finish), else the offline test voice.
 */
export function candidateAudio({ narrationProvider, cachedTake, musicFlag, musicSpecProvider }) {
  const notes = [];
  const flag = musicFlag == null ? null : String(musicFlag).toLowerCase();
  if (flag && !FREE_MUSIC_CHOICES.includes(flag)) throw new Error(`--candidate makes no paid calls, so it cannot use --music ${flag}; use --music synth or none (or drop --music)`);
  const music = flag ?? (musicSpecProvider === "file" ? "file" : "synth");
  const provider = String(narrationProvider ?? "kokoro").toLowerCase();
  let voice;
  if (FREE_VOICE_PROVIDERS.includes(provider)) voice = undefined;
  else if (cachedTake) { voice = undefined; notes.push(`candidate: reusing the cached ${provider} take (no voice call)`); }
  else { voice = "test"; notes.push(`candidate: ${provider} narration is not cached, so this candidate uses the offline test voice (word timings approximate the real take; run launchclip voice first to render candidates on the real take)`); }
  return { voice, music, notes };
}

const sha256 = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");

/** Lifecycle sample times (s): --at a,b,c, else entry/peak/settle at 15%, 50% and 90% of the clip. */
export function lifecycleTimes(duration, at) {
  if (at != null && at !== "") {
    const list = String(at).split(",").map((value) => Number(value.trim()));
    if (list.length < 3 || list.some((value) => !Number.isFinite(value) || value < 0 || value > duration)) throw new Error(`--at needs three or more comma-separated times within the clip (0–${duration}s), e.g. --at 0.4,1.2,2.6`);
    return list;
  }
  return [0.15, 0.5, 0.9].map((share) => Math.round(duration * share * 1000) / 1000);
}

/** Extract the frame with index round(t × fps) by number (select=eq(n,N)), never by seeking. */
export async function extractFrame(video, frame, output) {
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", video, "-vf", `select=eq(n\\,${frame})`, "-vsync", "0", "-frames:v", "1", output]);
  if (!existsSync(output)) throw new Error(`ffmpeg wrote no frame ${frame} from ${video}`);
}

/**
 * Record one rendered candidate into <into>/qa/rendered-candidates.json.
 * options: {into, id, comparison, kind, boundary, video, fps, duration, at, extract}
 * → {receipt, comparison, candidate, artifacts}
 */
export async function recordCandidate(options) {
  const { into, id, video, fps, duration } = options;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(id ?? ""))) throw new Error(`--candidate needs an id of letters, digits, dots, dashes or underscores (e.g. open-a); got ${id}`);
  const kind = options.kind ?? (options.boundary ? "transition" : "opening");
  if (!["opening", "transition"].includes(kind)) throw new Error(`--kind must be opening or transition; got ${kind}`);
  if (kind === "transition" && !options.boundary) throw new Error("a transition candidate needs --boundary <boundary id> (the composition boundary it solves, e.g. s3)");
  const comparisonId = String(options.comparison ?? (kind === "transition" ? `transition-${options.boundary}` : "opening"));
  const extract = options.extract ?? extractFrame;
  const dir = path.join(into, CANDIDATE_DIR, id);
  await mkdir(dir, { recursive: true });
  const clip = path.join(dir, "candidate.mp4");
  await copyFile(video, clip);
  const frames = [];
  for (const t of lifecycleTimes(duration, options.at)) {
    const frame = Math.min(Math.round(t * fps), Math.max(0, Math.round(duration * fps) - 1));
    const file = path.join(dir, `frame-${String(frame).padStart(4, "0")}.png`);
    await extract(clip, frame, file);
    frames.push(file);
  }
  const relative = (file) => path.relative(into, file).split(path.sep).join("/");
  const artifacts = [];
  for (const file of [clip, ...frames]) artifacts.push({ file: relative(file), sha256: await sha256(file) });
  const receiptFile = path.join(into, CANDIDATE_RECEIPT);
  const receipt = existsSync(receiptFile) ? JSON.parse(await readFile(receiptFile, "utf8")) : { schema_version: SUBSCRIPTION_CANDIDATE_RECEIPT_VERSION, comparisons: [] };
  receipt.schema_version = SUBSCRIPTION_CANDIDATE_RECEIPT_VERSION;
  if (!Array.isArray(receipt.comparisons)) receipt.comparisons = [];
  let comparison = receipt.comparisons.find((entry) => entry?.id === comparisonId);
  if (!comparison) {
    comparison = { id: comparisonId, kind, ...(kind === "transition" ? { boundary_id: options.boundary } : {}), judging_basis: "rendered-pixels-and-motion", candidate_order: [], candidates: [], selected_candidate_id: null, selection_rationale: "" };
    receipt.comparisons.push(comparison);
  }
  if (comparison.kind !== kind) throw new Error(`comparison ${comparisonId} is a ${comparison.kind} comparison, not ${kind}`);
  const previous = comparison.candidates.find((entry) => entry?.id === id);
  const candidate = {
    id,
    render_id: `${id}-${artifacts[0].sha256.slice(0, 12)}`,
    admissible: true,
    source_project: options.source ?? null,
    artifacts,
    // Judged from the pixels afterwards (0–10 each); a rerender keeps them.
    scores: previous?.scores ?? { ...CANDIDATE_SCORE_TEMPLATE },
    ...(previous?.rejection_reason ? { rejection_reason: previous.rejection_reason } : {})
  };
  comparison.candidates = [...comparison.candidates.filter((entry) => entry?.id !== id), candidate];
  if (!comparison.candidate_order.includes(id)) comparison.candidate_order.push(id);
  await mkdir(path.dirname(receiptFile), { recursive: true });
  await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
  return { receipt: receiptFile, comparison: comparisonId, candidate, artifacts: artifacts.map((entry) => entry.file) };
}

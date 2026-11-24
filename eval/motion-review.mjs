// Motion review against a reference clip: a review pack a person (or an
// agent) fills in by watching the video, and a check that the filled review
// is complete, current and carries every earlier failure to a resolution.
//
//   launchclip review-motion <project|video> [--video <file>] [--reference <clip>]
//     [--reference-range 0-3,5-8] [--previous <motion-review.json>] [--out <dir>]
//     [--model provider:model] [--json]
//   launchclip review-motion check <motion-review.json|pack dir> [--previous <motion-review.json>] [--json]
//
//   buildMotionReviewPack(target, options) → {dir, review, file, viewer}
//   checkMotionReview(file, {previous})    → {ok, verdict, errors, pending, decisions}
//   visionMotionJudge(client)              → judge({shot, frames, reference}) → {checks}
//
// The pack: per shot a clip and three-frame strips (consecutive frames) at the
// cut in, each pose change (a contact or a new pose, from the project's shot
// list) and the cut out; the reference clip's excerpts the same way; an
// index.html contact sheet; and motion-review.json with every check pending,
// bound to the video's and the reference's sha256 and to every file in the pack.
//
// Three decisions stay separate: technical (gates, encode), motion (this
// review) and the user's. Only the motion decision is checked here; a
// passing check proves the review is complete and current, not that the
// observations are true. A vision model's first pass is written as
// `suggested` beside a check and never sets its status.
//
// The review's shape follows the B6 motion review of the stickman director
// skill (MIT, Stickman Video Director contributors), rewritten and cut down.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { measureFrame, medianRatio } from "./limb-weight.mjs";

const execFileAsync = promisify(execFile);
export const MOTION_REVIEW_SCHEMA = "launchclip.motion-review.v1";
export const MOTION_REVIEW_FILE = "motion-review.json";
export const VERDICTS = Object.freeze(["pass", "needs_repair", "not_applicable"]);
// What every shot is asked. A verdict is pass, needs_repair or a justified not_applicable.
export const SHOT_CHECKS = Object.freeze({
  space_camera: "Did the promised space or camera effect happen? Name the time range and what changes in the spatial relationship (a uniform zoom of the whole frame is a reframe, not a depth move).",
  gesture: "Does the gesture read? Point to anticipation, action, contact, release and recovery, and the body (not only the wrists) carrying it. A deliberate still pose is fine when it is explained.",
  reaction: "Does the reaction develop? Where the eyes go, when face and body change, and the moment the emotion becomes readable.",
  rhythm: "Does the rhythm guide attention? What motivates each move or cut, where it lands, and whether anything competes with it.",
  drawing: "Is the drawing and composition intact? Limbs and face at full size, line consistency, occlusion, edges of frame, captions."
});
export const LIMB_WEIGHT_QUESTION = "Does limb weight match the reference? Compare arms and legs in similar views at matched head width (the measured stroke/head ratios are a guide), and record how the scale was matched in comparison_basis.";
// Scene-change score above which a bare video is cut into shots.
const CUT_SCORE = 0.3;
const MAX_MOMENTS = 6;
const round = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places;
const text = (value) => typeof value === "string" && value.trim() !== "";
const run = (command, args, options = {}) => execFileAsync(command, args, { maxBuffer: 256 * 1024 * 1024, ...options });

export async function sha256File(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

async function probe(file, exec) {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", file]);
  const data = JSON.parse(stdout);
  const stream = data.streams?.[0];
  if (!stream) throw new Error(`no video stream in ${file}`);
  const [num, den] = String(stream.r_frame_rate ?? "30/1").split("/").map(Number);
  return { width: Number(stream.width), height: Number(stream.height), fps: den ? round(num / den) : 30, duration: round(Number(data.format?.duration)) };
}

/** Shots of a bare video from ffmpeg's scene-change score → [{id, start, end}]. */
export async function detectShots(video, duration, { exec = run } = {}) {
  const { stderr } = await exec("ffmpeg", ["-hide_banner", "-nostats", "-i", video, "-vf", `select='gt(scene,${CUT_SCORE})',showinfo`, "-an", "-f", "null", "-"]);
  const cuts = [...String(stderr).matchAll(/pts_time:([0-9.]+)/g)].map((match) => Number(match[1])).filter((t) => t > 0.05 && t < duration - 0.05);
  const edges = [0, ...cuts, duration];
  return edges.slice(0, -1).map((start, index) => ({ id: `shot-${index + 1}`, start: round(start), end: round(edges[index + 1]), changes: [] }));
}

/** A project's shots (src/story_shots.js) with their pose changes, and the video it rendered. */
async function projectShots(project) {
  const { storyShotsCommand } = await import("../src/story_shots.js");
  const report = await storyShotsCommand(project);
  const rig = await rigShotMetrics(project);
  return report.shots.map((shot) => ({
    ...(rig.has(shot.id) ? { rig: rig.get(shot.id) } : {}),
    id: String(shot.id ?? `shot-${shot.shot}`),
    start: Number(shot.start),
    end: Number(shot.end),
    changes: Object.entries(shot.poses ?? {}).flatMap(([who, poses]) => poses.slice(1).map((pose) => ({ at: pose.at, why: `${who}: ${[pose.pose, pose.expression, pose.action].filter(Boolean).join(", ") || "pose change"}` })))
  }));
}

/**
 * The per-frame rig's measures for each scene that uses it (src/rig_gate.js,
 * the rig gate's own numbers): id → {measured, findings, note}. Empty when no
 * scene does.
 */
export async function rigShotMetrics(project) {
  const { readProjectStory } = await import("../src/story_loader.js");
  const { measureRigScenes, rigScenes, storyFps, RIG_THRESHOLDS } = await import("../src/rig_gate.js");
  const { rigFindings, rigSummary } = await import("@launchclip/core/characters/rig-metrics.mjs");
  const loaded = await readProjectStory(project);
  const scenes = loaded ? rigScenes(loaded.resolved) : [];
  return new Map(measureRigScenes(scenes, { fps: storyFps(loaded?.resolved) }).map((scene) => [scene.id, {
    measured: rigSummary(scene.measures),
    findings: rigFindings(scene.measures, RIG_THRESHOLDS).map((finding) => `${finding.severity}: ${finding.detail}`),
    note: "joint and prop measures from the rig plan (kit/core/characters/rig-metrics.mjs, the finish rig gate's numbers); a guide for the reviewer, not a verdict"
  }]));
}

/** "0-3,5.5-8" → [{start, end}] */
export function parseRanges(value, duration) {
  if (!value) return [{ start: 0, end: duration }];
  return String(value).split(",").map((part) => {
    const [start, end] = part.split("-").map(Number);
    if (!(start >= 0 && end > start)) throw new Error(`--reference-range wants start-end seconds like 0-3,5-8; got ${part}`);
    return { start, end: Math.min(end, duration) };
  });
}

/** The moments worth decoding in a span: cut in, each change, cut out (at most MAX_MOMENTS). */
function moments(span, fps) {
  const frame = 1 / fps;
  const inside = span.changes.filter((change) => change.at > span.start + frame && change.at < span.end - frame).sort((a, b) => a.at - b.at);
  const picked = inside.length > MAX_MOMENTS - 2 ? inside.filter((_, index) => index % Math.ceil(inside.length / (MAX_MOMENTS - 2)) === 0) : inside;
  const middle = picked.length ? [] : [{ at: (span.start + span.end) / 2, why: "middle (no pose change listed)" }];
  return [{ at: span.start, why: "cut in" }, ...picked, ...middle, { at: Math.max(span.start, span.end - frame), why: "cut out" }].map((moment) => ({ ...moment, at: round(moment.at) }));
}

const emptyCheck = () => ({ status: "pending", observation: "", evidence: [], reason: "" });

/**
 * Build a review pack. target: a project folder (its storyboard's shots and
 * renders/final.mp4 or renders/draft.mp4) or a video file.
 * options: {video, reference, referenceRanges, previous, out, judge, model, shots, exec}
 */
export async function buildMotionReviewPack(target, options = {}) {
  const { exec = run, judge = null } = options;
  const input = path.resolve(String(target));
  if (!existsSync(input)) throw new Error(`review-motion: ${target} not found`);
  const isProject = statSync(input).isDirectory();
  const video = options.video ? path.resolve(String(options.video)) : isProject ? ["renders/final.mp4", "renders/draft.mp4"].map((rel) => path.join(input, rel)).find(existsSync) : input;
  if (!video || !existsSync(video)) throw new Error(`review-motion: no video to review in ${target}; render it first or pass --video <file>`);
  const dir = path.resolve(String(options.out ?? path.join(isProject ? input : path.dirname(input), "qa", "motion-review")));
  if (existsSync(path.join(dir, MOTION_REVIEW_FILE))) throw new Error(`review-motion: ${path.join(dir, MOTION_REVIEW_FILE)} exists; a filled review is evidence, so pick a fresh --out`);
  await mkdir(dir, { recursive: true });

  const meta = await probe(video, exec);
  const spans = options.shots ?? (isProject ? await projectShots(input) : await detectShots(video, meta.duration, { exec }));
  if (!spans.length) throw new Error(`review-motion: no shots in ${target}`);
  const artifacts = {};
  const keep = async (file) => { const rel = path.relative(dir, file); artifacts[rel] = await sha256File(file); return rel; };
  const clip = async (source, start, end, name) => {
    const file = path.join(dir, name);
    await exec("ffmpeg", ["-v", "error", "-y", "-ss", String(start), "-i", source, "-t", String(round(end - start)), "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", file]);
    return keep(file);
  };
  // The frame before `at`, `at` and the one after, side by side, so a contact or a cut is seen frame by frame
  // (seeking half a frame early lands on the frame itself, not the next one).
  const strip = async (source, at, fps, name) => {
    const file = path.join(dir, name);
    await exec("ffmpeg", ["-v", "error", "-y", "-ss", String(Math.max(0, (Math.round(at * fps) - 1.5) / fps)), "-i", source, "-vf", "scale=-2:360,tile=3x1", "-frames:v", "1", "-update", "1", file]);
    return keep(file);
  };

  const shots = [];
  for (const [index, span] of spans.entries()) {
    const tag = `shot-${String(index + 1).padStart(2, "0")}`;
    const shotMoments = [];
    for (const [m, moment] of moments(span, meta.fps).entries()) shotMoments.push({ ...moment, strip: await strip(video, moment.at, meta.fps, `${tag}-m${m}.png`) });
    const limb = [];
    for (const moment of shotMoments.filter((entry) => entry.why !== "cut in" && entry.why !== "cut out")) limb.push({ at: moment.at, ...(await measureFrame(video, moment.at, { ...meta, exec })) });
    shots.push({
      id: span.id,
      start: round(span.start),
      end: round(span.end),
      clip: await clip(video, span.start, span.end, `${tag}.mp4`),
      moments: shotMoments,
      limb_weight: limb,
      ...(span.rig ? { rig_metrics: span.rig } : {}),
      checks: Object.fromEntries(Object.keys(SHOT_CHECKS).map((key) => [key, emptyCheck()]))
    });
  }

  let reference = null;
  if (options.reference) {
    const file = path.resolve(String(options.reference));
    if (!existsSync(file)) throw new Error(`review-motion: reference ${options.reference} not found`);
    const refMeta = await probe(file, exec);
    const segments = [];
    for (const [index, range] of parseRanges(options.referenceRanges, refMeta.duration).entries()) {
      const tag = `reference-${String(index + 1).padStart(2, "0")}`;
      const ats = [range.start + 1 / refMeta.fps, (range.start + range.end) / 2, range.end - 1 / refMeta.fps].map((at) => round(at));
      const strips = [];
      for (const [m, at] of ats.entries()) strips.push({ at, strip: await strip(file, at, refMeta.fps, `${tag}-m${m}.png`) });
      const limb = [];
      for (const at of ats) limb.push({ at, ...(await measureFrame(file, at, { ...refMeta, exec })) });
      segments.push({ id: tag, start: round(range.start), end: round(range.end), clip: await clip(file, range.start, range.end, `${tag}.mp4`), moments: strips, limb_weight: limb });
    }
    reference = { path: file, sha256: await sha256File(file), ...refMeta, segments };
  }

  const candidateRatio = medianRatio(shots.flatMap((shot) => shot.limb_weight));
  const referenceRatio = reference ? medianRatio(reference.segments.flatMap((segment) => segment.limb_weight)) : null;
  const previous = options.previous ? await previousIdentity(path.resolve(String(options.previous))) : null;
  const review = {
    schema: MOTION_REVIEW_SCHEMA,
    created_at: new Date().toISOString(),
    project: isProject ? input : null,
    video: { path: video, sha256: await sha256File(video), ...meta },
    reference,
    questions: { ...SHOT_CHECKS, limb_weight: LIMB_WEIGHT_QUESTION },
    decisions: {
      technical: { status: "pending", by: "", note: "" },
      motion: { status: "pending", reviewer: "", method: "", reviewed_at: "" },
      user: { status: "pending", by: "", note: "" }
    },
    checks: {
      limb_weight: {
        ...emptyCheck(),
        comparison_basis: "",
        measured: { candidate_ratio: candidateRatio, reference_ratio: referenceRatio, relative: candidateRatio && referenceRatio ? round(candidateRatio / referenceRatio) : null, note: "stroke width / head width from decoded frames (eval/limb-weight.mjs); a guide for the reviewer, not a verdict" }
      }
    },
    shots,
    previous_review: previous?.identity ?? null,
    repair_log: (previous?.findings ?? []).map((finding) => ({ ...finding, status: "pending", kind: "implementation_change", change: "", correction_reason: "", observation: "", evidence: [] })),
    remaining_gaps: [],
    artifacts
  };
  if (judge) await suggest(review, dir, judge, options.model);
  const viewer = path.join(dir, "index.html");
  await writeFile(viewer, contactSheet(review, dir));
  // The viewer is bound too, so a pack cannot be swapped under its review.
  review.artifacts["index.html"] = await sha256File(viewer);
  const file = path.join(dir, MOTION_REVIEW_FILE);
  await writeFile(file, `${JSON.stringify(review, null, 2)}\n`);
  return { dir, file, viewer, review };
}

async function previousIdentity(file) {
  if (!existsSync(file)) throw new Error(`review-motion: previous review ${file} not found`);
  const old = JSON.parse(await readFile(file, "utf8"));
  if (old.schema !== MOTION_REVIEW_SCHEMA) throw new Error(`review-motion: ${file} is not a ${MOTION_REVIEW_SCHEMA} review`);
  return { identity: { path: file, sha256: await sha256File(file), video_sha256: old.video?.sha256 ?? null }, findings: unresolvedFindings(old) };
}

/** Every failure a review leaves open: needs_repair checks, pending checks with an observation, gaps, unresolved repairs. */
export function unresolvedFindings(review) {
  const out = [];
  const open = (issue, row) => {
    if (row?.status === "needs_repair" || (row?.status === "pending" && text(row.observation))) out.push({ issue, previous_status: row.status, previous_observation: row.observation ?? "" });
  };
  open("limb_weight", review.checks?.limb_weight);
  for (const shot of review.shots ?? []) for (const [key, row] of Object.entries(shot.checks ?? {})) open(`${shot.id}.${key}`, row);
  (review.remaining_gaps ?? []).forEach((gap, index) => out.push({ issue: `gap-${index + 1}`, previous_status: "needs_repair", previous_observation: String(gap) }));
  for (const repair of review.repair_log ?? []) if (repair.status !== "resolved") out.push({ issue: repair.issue, previous_status: repair.previous_status, previous_observation: repair.previous_observation });
  return out;
}

/** Every check in a review → [[label, row]]. */
function allChecks(review) {
  return [["limb_weight", review.checks?.limb_weight], ...(review.shots ?? []).flatMap((shot) => Object.keys(SHOT_CHECKS).map((key) => [`${shot.id}.${key}`, shot.checks?.[key]]))];
}

/**
 * Check a filled review. file: motion-review.json or its pack folder.
 * previous: the earlier review whose failures must be resolved (default: the one the pack names).
 * → {ok, verdict, errors, pending, decisions}
 */
export async function checkMotionReview(target, { previous = null } = {}) {
  let file = path.resolve(String(target));
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, MOTION_REVIEW_FILE);
  if (!existsSync(file)) throw new Error(`review-motion check: ${file} not found`);
  const dir = path.dirname(file);
  const review = JSON.parse(await readFile(file, "utf8"));
  const errors = [];
  if (review.schema !== MOTION_REVIEW_SCHEMA) errors.push(`schema is ${review.schema}, not ${MOTION_REVIEW_SCHEMA}`);

  // Fingerprints: the review describes these exact files.
  const same = async (label, entry) => {
    if (!entry?.path || !existsSync(entry.path)) errors.push(`${label} ${entry?.path ?? "(no path)"} is missing`);
    else if ((await sha256File(entry.path)) !== entry.sha256) errors.push(`${label} ${entry.path} changed since the pack was made (sha256 differs): make a fresh pack for the new file`);
  };
  await same("video", review.video);
  if (review.reference) await same("reference", review.reference);
  for (const [rel, sha] of Object.entries(review.artifacts ?? {})) {
    const at = path.join(dir, rel);
    if (!existsSync(at)) errors.push(`pack file ${rel} is missing`);
    else if ((await sha256File(at)) !== sha) errors.push(`pack file ${rel} changed since the pack was made`);
  }

  let pending = 0;
  const open = [];
  for (const [label, row] of allChecks(review)) {
    if (!row) { errors.push(`${label}: missing`); continue; }
    if (row.status === "pending") {
      pending += 1;
      errors.push(`${label}: pending${row.suggested ? " (a model's suggestion is not a verdict)" : ""}`);
      continue;
    }
    if (!VERDICTS.includes(row.status)) { errors.push(`${label}: status must be one of pending, ${VERDICTS.join(", ")}; got ${row.status}`); continue; }
    if (row.status === "not_applicable") {
      if (!text(row.reason)) errors.push(`${label}: not_applicable needs a reason`);
      if (label === "limb_weight" && review.reference) errors.push("limb_weight: cannot be not_applicable when there is a reference to compare with");
      continue;
    }
    if (!text(row.observation)) errors.push(`${label}: ${row.status} needs the observation`);
    if (!Array.isArray(row.evidence) || !row.evidence.length) errors.push(`${label}: ${row.status} needs evidence (pack files or time ranges)`);
    for (const item of row.evidence ?? []) {
      // A pack file named as evidence must exist; a time range ("1.2-1.8s") is free text.
      if (/\.(png|jpe?g|mp4|webm|mov)$/i.test(String(item)) && !existsSync(path.resolve(dir, String(item)))) errors.push(`${label}: evidence ${item} is not a file in the pack`);
    }
    if (label === "limb_weight" && row.status === "pass" && !text(row.comparison_basis)) errors.push("limb_weight: a pass needs comparison_basis (which frames, how head width was matched)");
    if (row.status === "needs_repair") open.push(label);
  }

  // Earlier failures: every one carried into the repair log and resolved.
  const previousFile = previous ? path.resolve(String(previous)) : review.previous_review?.path ?? null;
  const repairs = Array.isArray(review.repair_log) ? review.repair_log : [];
  if (previousFile) {
    if (!existsSync(previousFile)) errors.push(`previous review ${previousFile} is missing; keep it, it is the record of what failed`);
    else {
      const old = JSON.parse(await readFile(previousFile, "utf8"));
      const sha = await sha256File(previousFile);
      if (!review.previous_review) errors.push(`the review does not name its previous review; make the pack with --previous ${previousFile}`);
      else if (review.previous_review.sha256 !== sha) errors.push(`previous review ${previousFile} is not the one the pack was made from (sha256 differs)`);
      const logged = new Set(repairs.map((repair) => repair.issue));
      for (const finding of unresolvedFindings(old)) if (!logged.has(finding.issue)) errors.push(`repair log dropped ${finding.issue} (${finding.previous_status}: ${finding.previous_observation || "no observation"})`);
    }
  } else if (repairs.length) errors.push("the repair log has entries but no previous review");
  for (const repair of repairs) {
    const label = `repair ${repair.issue}`;
    if (repair.status !== "resolved") { errors.push(`${label}: ${repair.status ?? "pending"}`); open.push(label); continue; }
    if (!text(repair.observation)) errors.push(`${label}: needs the new observation`);
    if (!Array.isArray(repair.evidence) || !repair.evidence.length) errors.push(`${label}: needs evidence`);
    if (repair.kind === "review_correction") {
      if (!text(repair.correction_reason)) errors.push(`${label}: review_correction needs correction_reason (what the earlier review got wrong)`);
    } else {
      if (!text(repair.change)) errors.push(`${label}: needs the change that fixed it`);
      if (review.previous_review?.video_sha256 && review.previous_review.video_sha256 === review.video?.sha256) errors.push(`${label}: claims an implementation change but the video is the same file as before`);
    }
  }
  (review.remaining_gaps ?? []).forEach((gap) => open.push(`gap: ${gap}`));

  const motion = review.decisions?.motion ?? {};
  const verdict = motion.status ?? "pending";
  if (verdict === "pending") errors.push("decisions.motion is pending: watch the video and the reference, then set it to pass or needs_repair");
  else if (!["pass", "needs_repair"].includes(verdict)) errors.push(`decisions.motion.status must be pass or needs_repair; got ${verdict}`);
  if (verdict !== "pending") for (const key of ["reviewer", "method", "reviewed_at"]) if (!text(motion[key])) errors.push(`decisions.motion.${key} is empty`);
  if (verdict === "pass" && open.length) errors.push(`decisions.motion is pass but these are open: ${open.join("; ")}`);
  return {
    ok: !errors.length && verdict === "pass",
    verdict,
    errors,
    pending,
    open,
    decisions: Object.fromEntries(Object.entries(review.decisions ?? {}).map(([key, value]) => [key, value?.status ?? "pending"])),
    file
  };
}

// ---------------------------------------------------------------------------
// Optional first pass by a vision model: suggestions only.

const JUDGE_ROW = { type: "object", additionalProperties: false, required: ["verdict", "observation"], properties: { verdict: { type: "string", enum: VERDICTS }, observation: { type: "string" } } };
const JUDGE_SCHEMA = Object.freeze({ type: "object", additionalProperties: false, required: ["checks"], properties: { checks: { type: "object", additionalProperties: false, required: Object.keys(SHOT_CHECKS), properties: Object.fromEntries(Object.keys(SHOT_CHECKS).map((key) => [key, JUDGE_ROW])) } } });

/** client: a runStructured client that takes images (src/make/models.js createMakeClient). */
export function visionMotionJudge(client, { readImage = dataUrl } = {}) {
  return async ({ shot, frames, reference }) => {
    const images = [...frames, ...reference];
    const result = await client.runStructured({
      instructions: "You review the motion of an animated shot against a reference clip. Each image is a strip of three consecutive frames. Answer each question from what the frames show; when the frames cannot show it (timing, sound), say so and answer needs_repair rather than guess a pass.",
      input: [
        `Shot ${shot.id}, ${shot.start}-${shot.end}s. The first ${frames.length} strip(s) are this shot (${shot.moments.map((moment) => `${moment.at}s ${moment.why}`).join("; ")}); the last ${reference.length} are the reference.`,
        ...Object.entries(SHOT_CHECKS).map(([key, question]) => `${key}: ${question}`)
      ].join("\n"),
      images: await Promise.all(images.map(async (file) => ({ url: await readImage(file), detail: "high" }))),
      schema: JUDGE_SCHEMA,
      schemaName: "launchclip_motion_review",
      maxOutputTokens: 900
    });
    return { checks: result?.value?.checks ?? {} };
  };
}

async function suggest(review, dir, judge, model) {
  const reference = (review.reference?.segments ?? []).flatMap((segment) => segment.moments.map((moment) => path.join(dir, moment.strip)));
  for (const shot of review.shots) {
    const { checks } = await judge({ shot, frames: shot.moments.map((moment) => path.join(dir, moment.strip)), reference });
    for (const key of Object.keys(SHOT_CHECKS)) {
      const row = checks?.[key];
      if (row && VERDICTS.includes(row.verdict)) shot.checks[key].suggested = { verdict: row.verdict, observation: String(row.observation ?? ""), by: model ?? "vision model" };
    }
  }
}

async function dataUrl(file) {
  return `data:image/png;base64,${(await readFile(file)).toString("base64")}`;
}

// ---------------------------------------------------------------------------
// The contact sheet and the text report.

const esc = (value) => String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function contactSheet(review, dir) {
  const ref = review.reference;
  const refStrips = ref ? ref.segments.flatMap((segment) => segment.moments.map((moment) => `<figure><img src="${esc(moment.strip)}" loading="lazy"><figcaption>reference ${moment.at}s</figcaption></figure>`)).join("") : "<p>No reference clip: limb weight and motion are judged against the brief alone.</p>";
  const measured = review.checks.limb_weight.measured;
  const shots = review.shots.map((shot) => `
<section><h2>${esc(shot.id)} · ${shot.start}–${shot.end}s</h2>
<div class="row"><video controls preload="metadata" src="${esc(shot.clip)}"></video>
<div class="strips">${shot.moments.map((moment) => `<figure><img src="${esc(moment.strip)}" loading="lazy"><figcaption>${moment.at}s · ${esc(moment.why)}</figcaption></figure>`).join("")}</div>
<div class="strips ref">${refStrips}</div></div>
${shot.rig_metrics ? rigMetricsHtml(shot.rig_metrics) : ""}
<ul>${Object.entries(SHOT_CHECKS).map(([key, question]) => `<li><b>${key}</b> — pending${shot.checks[key].suggested ? ` <i>(model suggests ${esc(shot.checks[key].suggested.verdict)}: ${esc(shot.checks[key].suggested.observation)})</i>` : ""}<br><small>${esc(question)}</small></li>`).join("")}</ul></section>`).join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Motion review</title>
<style>body{font:15px/1.45 system-ui,sans-serif;margin:0 auto;padding:16px;max-width:1500px;background:#1d1b1f;color:#f3ece2}section{border-top:1px solid #554;padding:16px 0}.row{display:grid;grid-template-columns:minmax(0,320px) 1fr 1fr;gap:12px}@media (max-width:900px){.row{grid-template-columns:1fr}}video,img{width:100%;background:#000}figure{margin:0 0 8px}figcaption,small{color:#b9ad9d}.ref figcaption{color:#9cc3e6}code{word-break:break-all}</style>
<h1>Motion review · pending</h1>
<p>Watch the whole video at speed with sound, then each shot against the reference. Each strip is three consecutive frames. Fill <code>${MOTION_REVIEW_FILE}</code>: every check gets pass, needs_repair or not_applicable with a reason, an observation and evidence; then <code>launchclip review-motion check ${esc(dir)}</code>. A model's suggestion is never a verdict, and this review is not the user's decision.</p>
<p>Video <code>${esc(review.video.path)}</code> sha256 <code>${review.video.sha256}</code>${ref ? `<br>Reference <code>${esc(ref.path)}</code> sha256 <code>${ref.sha256}</code>` : ""}</p>
<video controls preload="metadata" src="${esc(path.relative(dir, review.video.path))}" style="max-width:420px"></video>
<h2>Limb weight</h2><p>${esc(LIMB_WEIGHT_QUESTION)}</p><p>Measured stroke/head: candidate ${measured.candidate_ratio ?? "n/a"}, reference ${measured.reference_ratio ?? "n/a"}${measured.relative ? ` (candidate is ${measured.relative}× the reference)` : ""}.</p>
${review.repair_log.length ? `<h2>Carried from the previous review</h2><ul>${review.repair_log.map((repair) => `<li><b>${esc(repair.issue)}</b> (${esc(repair.previous_status)}): ${esc(repair.previous_observation)}</li>`).join("")}</ul>` : ""}
${shots}`;
}

function rigMetricsHtml(rig) {
  const actors = Object.entries(rig.measured.actors).map(([id, m]) => `<li><b>${esc(id)}</b>: foot slide ${m.foot_slide_px} px over ${m.planted_steps} planted steps, bone drift ${m.bone_drift_px} px, jerk per unit of motion ${m.jerk_per_motion}/s², hand corners ${m.hand_corners}, crossing frames (arms ${m.crossing_frames.arms}, arm/leg ${m.crossing_frames.arm_leg})</li>`);
  const props = Object.entries(rig.measured.props).map(([id, m]) => `<li><b>${esc(id)}</b>: grip loss ${m.grip_loss_px} px, ${m.teleports} teleport(s)</li>`);
  return `<h3>Rig measures</h3><p><small>${esc(rig.note)}</small></p><ul>${[...actors, ...props].join("")}</ul>${rig.findings.length ? `<ul>${rig.findings.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>` : ""}`;
}

/** The pack or the check as lines a person reads. */
export function formatMotionReview(result) {
  if (result.review) {
    const { review } = result;
    const m = review.checks.limb_weight.measured;
    return `${[
      `motion review pack: ${result.dir}`,
      `  ${review.shots.length} shot(s), ${review.shots.reduce((sum, shot) => sum + shot.moments.length, 0)} frame strips${review.reference ? `, ${review.reference.segments.length} reference excerpt(s)` : ", no reference"}`,
      `  limb weight (stroke/head): candidate ${m.candidate_ratio ?? "n/a"}, reference ${m.reference_ratio ?? "n/a"}`,
      ...(review.repair_log.length ? [`  ${review.repair_log.length} earlier failure(s) carried into the repair log`] : []),
      `  open ${result.viewer}, fill ${result.file}, then: launchclip review-motion check ${result.dir}`
    ].join("\n")}\n`;
  }
  const head = `motion review: ${result.ok ? "pass" : result.verdict === "needs_repair" && !result.errors.length ? "needs repair" : "incomplete"} (motion ${result.verdict}, technical ${result.decisions.technical ?? "pending"}, user ${result.decisions.user ?? "pending"})`;
  return `${[head, ...result.errors.map((error) => `  - ${error}`), ...(!result.errors.length && result.open.length ? result.open.map((item) => `  open: ${item}`) : [])].join("\n")}\n`;
}

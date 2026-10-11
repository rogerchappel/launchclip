import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { editRecording } from "./recording_edit_media.js";
import { normalizeRecordingTranscript } from "./recording_edit.js";
import { assessRecordingQa, identifyRecordingCoherence, recordingQaEvidenceHash } from "./recording_qa.js";
import { analyzeRecordingJoins, repairRecordingPlan } from "./recording_qa_repair.js";

/** Render, independently transcribe, review and safely retry without publishing failed candidates. */
export async function runRecordingQa(input, initialPlan, options, adapters = {}) {
  const maximum = options.maxAttempts ?? 3;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 5) throw new Error("Recording QA attempts must be an integer between 1 and 5");
  const directory = path.join(path.resolve(options.directory), "qa");
  const sessionPath = path.join(directory, "session.json");
  let session = await readJson(sessionPath);
  if (session && session.request_hash !== options.requestHash) throw new Error("Recording QA session belongs to different input, settings or engine. Use a fresh output directory.");
  if (!session) session = { schema_version: "launchclip.recording-qa-session.v1", request_hash: options.requestHash, attempts: [] };
  const sourceHash = digest(options.sourceTranscript);
  if (session.source_transcript_hash && session.source_transcript_hash !== sourceHash) throw new Error("Recording QA source transcript changed; use a fresh output directory.");
  session.source_transcript_hash = sourceHash;
  const reviews = options.decisions === undefined ? [] : reviewList(options.decisions);
  let plan = initialPlan;
  const seen = new Set();
  let latest;
  let expandedSeconds = 0;
  for (let index = 0; index < maximum; index++) {
    const planHash = digest(plan);
    if (seen.has(planHash)) throw new Error("Recording QA repair repeated an earlier plan");
    seen.add(planHash);
    let attempt = session.attempts[index];
    const attemptDirectory = path.join(directory, `attempt-${index + 1}`);
    if (attempt && attempt.plan_hash !== planHash) throw new Error("Recording QA candidate does not match its saved plan. Use a fresh output directory.");
    if (attempt) {
      for (const [key, expected] of Object.entries(attempt.checksums)) {
        if (await checksum(attempt.files[key]) !== expected) throw new Error(`Recording QA ${key} artifact changed; use a fresh output directory.`);
      }
    } else {
      await mkdir(attemptDirectory, { recursive: true });
      const files = { media: path.join(attemptDirectory, "video.mp4"), plan: path.join(attemptDirectory, "plan.json"), rendered_transcript: path.join(attemptDirectory, "rendered-transcript.json"), acoustic: path.join(attemptDirectory, "joins.json") };
      for (const file of Object.values(files)) if (await exists(file)) throw new Error("Recording QA candidate exists without a verified receipt; use a fresh output directory.");
      const rendered = await (adapters.editRecording ?? editRecording)(input, files.media, plan, { crf: options.crf ?? 18 });
      if (typeof adapters.transcribeRendered !== "function") throw new Error("Recording QA requires independent transcription of the rendered video");
      const transcript = await adapters.transcribeRendered(files.media, { model: options.transcriptionModel ?? "base.en", language: options.language ?? "en" });
      const words = normalizeRecordingTranscript(transcript);
      const renderedDuration = rendered.rendered_duration_seconds ?? rendered.duration_seconds ?? plan.duration_seconds;
      if (words.at(-1).end > renderedDuration + 0.05) throw new Error("Rendered QA transcript exceeds candidate duration");
      const actual = { text: words.map((word) => word.word).join(" "), words, duration_seconds: renderedDuration };
      const acoustic = await inspectEveryJoin(files.media, plan, adapters);
      await writeJson(files.plan, plan);
      await writeJson(files.rendered_transcript, actual);
      await writeJson(files.acoustic, acoustic);
      const checksums = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await checksum(file)])));
      attempt = { number: index + 1, plan_hash: planHash, files, checksums, rendered_duration_seconds: renderedDuration, assessments: [] };
      session.attempts.push(attempt);
      await writeJson(sessionPath, session);
    }
    const actual = JSON.parse(await readFile(attempt.files.rendered_transcript, "utf8"));
    const acoustic = JSON.parse(await readFile(attempt.files.acoustic, "utf8"));
    const evidenceHash = recordingQaEvidenceHash(plan, actual, attempt.checksums.media, options.sourceTranscript, acoustic);
    const supplied = reviews.find((review) => review.evidence_hash === evidenceHash);
    let semantic;
    if (supplied || options.model || adapters.identifyRecordingCoherence) {
      semantic = await (adapters.identifyRecordingCoherence ?? identifyRecordingCoherence)(plan, actual, { model: options.model, baseUrl: options.baseUrl, ...(supplied ? { decisions: supplied } : {}), mediaSha256: attempt.checksums.media, sourceTranscript: options.sourceTranscript, acoustic }, adapters.coherence);
    }
    const assessment = assessRecordingQa(plan, actual, { acoustic, ...(semantic ? { semantic } : {}), mediaSha256: attempt.checksums.media, sourceTranscript: options.sourceTranscript });
    const assessmentPath = path.join(attemptDirectory, `assessment-${digest({ assessment, semantic: semantic ?? null })}.json`);
    const report = { ...assessment, evidence_hash: evidenceHash, attempt: index + 1, media_sha256: attempt.checksums.media, candidate: attempt.files.media, rendered_transcript: attempt.files.rendered_transcript, acoustic: attempt.files.acoustic, ...(semantic ? { semantic } : {}) };
    await writeJson(assessmentPath, report);
    if (!attempt.assessments.includes(assessmentPath)) attempt.assessments.push(assessmentPath);
    latest = { status: report.status, plan, report, files: { ...attempt.files, qa_report: assessmentPath, qa_session: sessionPath }, rendered_duration_seconds: attempt.rendered_duration_seconds, attempts: session.attempts.length };
    if (report.status === "passed") { session.status = "passed"; session.accepted_attempt = index + 1; await writeJson(sessionPath, session); return latest; }
    if (!report.repair_requests.length || index + 1 === maximum) {
      if (report.status === "repair-needed") return stopQa(latest, session, sessionPath, "repair-attempt-limit");
      session.status = report.status;
      await writeJson(sessionPath, session);
      return latest;
    }
    const repaired = (adapters.repairRecordingPlan ?? repairRecordingPlan)(plan, report.repair_requests, { sourceTranscript: options.sourceTranscript, protectedCuts: options.protectedCuts, maxExpansionSeconds: 0.2, totalMaxExpansionSeconds: Math.max(0, 0.6 - expandedSeconds), trimEdges: true });
    attempt.repair = { applied: repaired.applied, rejected: repaired.rejected, changed: repaired.changed };
    if (!repaired.changed || seen.has(digest(repaired.plan))) {
      return stopQa(latest, session, sessionPath, "no-safe-repair", { repair: attempt.repair });
    }
    expandedSeconds += repaired.applied.reduce((sum, entry) => sum + (entry.applied_seconds ?? 0), 0);
    plan = repaired.plan;
    session.status = "repairing";
    await writeJson(sessionPath, session);
  }
  return latest;
}

async function inspectEveryJoin(media, plan, adapters) {
  if (adapters.analyzeRecordingJoins) return adapters.analyzeRecordingJoins(media, plan);
  const count = plan.kept_segments.length - 1;
  const measurements = [];
  const issues = [];
  let offset = 0;
  do {
    const batch = await analyzeRecordingJoins(media, plan, { maxJoins: 128, joinOffset: offset });
    measurements.push(...batch.measurements);
    issues.push(...batch.issues);
    if (batch.next_join_offset === null) break;
    if (!Number.isInteger(batch.next_join_offset) || batch.next_join_offset <= offset) throw new Error("Recording join QA batch made no progress");
    offset = batch.next_join_offset;
  } while (offset < count);
  const indices = measurements.map((entry) => entry.segment_index);
  const covered = new Set(indices);
  const checked = indices.length === count && covered.size === count && Array.from({ length: count }, (_, index) => index + 1).every((index) => covered.has(index));
  return { schema_version: "launchclip.recording-joins.v1", checked, sampled_joins: measurements.length, total_joins: count, issues, measurements, unresolved_joins: Array.from({ length: count }, (_, index) => index + 1).filter((index) => !covered.has(index)) };
}

async function stopQa(latest, session, sessionPath, reason, details = {}) {
  const report = { ...latest.report, status: "needs-attention", stop_reason: reason, ...details };
  const reportPath = path.join(path.dirname(latest.files.qa_report), `assessment-${digest(report)}.json`);
  await writeJson(reportPath, report);
  const attempt = session.attempts[report.attempt - 1];
  if (!attempt.assessments.includes(reportPath)) attempt.assessments.push(reportPath);
  session.status = "needs-attention";
  await writeJson(sessionPath, session);
  return { ...latest, status: "needs-attention", report, files: { ...latest.files, qa_report: reportPath } };
}

function reviewList(value) {
  const reviews = value?.reviews ?? (value?.evidence_hash ? [value] : null);
  if (!Array.isArray(reviews) || reviews.some((review) => typeof review?.evidence_hash !== "string")) throw new Error("Recording QA decisions require a receipt or {reviews:[receipts]}");
  const hashes = reviews.map((review) => review.evidence_hash);
  if (new Set(hashes).size !== hashes.length) throw new Error("Recording QA receipts must have unique evidence hashes");
  return reviews;
}
async function readJson(file) { try { return JSON.parse(await readFile(file, "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
async function exists(file) { try { await stat(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
async function checksum(file) { const hash = createHash("sha256"); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest("hex"); }
function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}

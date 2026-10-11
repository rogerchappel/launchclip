import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizeRecordingTranscript } from "./recording_edit.js";
const execute = promisify(execFile);
const EPSILON = 1e-6;
const PROTECTED_REASONS = new Set(["filler", "false-start", "repeated-take", "semantic-retake", "rejected-splice-handle"]);

/** Recover only the boundary of a retained word; unsupported edits fail closed. */
export function repairRecordingPlan(plan, requests = [], options = {}) {
  const { ranges, sourceWords } = unpackPlan(plan);
  if (!Array.isArray(requests)) throw new Error("Recording repairs require an array");
  const maxExpansion = bound(options.maxExpansionSeconds ?? 0.2, 0.2, "maxExpansionSeconds");
  const totalMaximum = bound(options.totalMaxExpansionSeconds ?? 0.6, 0.6, "totalMaxExpansionSeconds");
  const originalWords = options.sourceTranscript ? normalizeRecordingTranscript(options.sourceTranscript) : [];
  const protectedCuts = [...plan.removed_segments.filter((cut) => PROTECTED_REASONS.has(cut.reason)), ...(options.protectedCuts ?? [])].map((cut) => checkedRange(cut.source_start_seconds ?? cut.start, cut.source_end_seconds ?? cut.end, plan.source_duration_seconds));
  const applied = [];
  const rejected = [];
  let expanded = 0;
  for (const request of requests) {
    try {
      if (request?.kind !== "expand-boundary") throw new Error("Unsupported repair; complete unique speech cannot be removed automatically");
      if (!Number.isInteger(request.segment_index) || request.segment_index < 0 || request.segment_index >= ranges.length || !["start", "end"].includes(request.edge)) throw new Error("Invalid repair boundary");
      if (!Number.isFinite(request.seconds) || request.seconds <= 0 || request.seconds > maxExpansion + EPSILON || typeof request.explanation !== "string" || !request.explanation.trim()) throw new Error("Repair requires bounded seconds and an explanation");
      const segment = ranges[request.segment_index];
      const accepted = sourceWords.filter((word) => word.segment === request.segment_index);
      if (!accepted.length) throw new Error("A wordless splice cannot recover speech");
      const word = request.edge === "start" ? accepted[0] : accepted.at(-1);
      const candidates = originalWords.filter((source) => text(source.word) === text(word.word) && source.start < word.end + EPSILON && source.end > word.start - EPSILON);
      if (candidates.length !== 1) throw new Error("Original source word cannot be identified unambiguously");
      let source = candidates[0];
      const proof = request.evidence;
      if (proof?.acoustic_proven === true && proof?.retranscription_proven === true) {
        const independentlyTimed = proof.source_word;
        checkedRange(independentlyTimed?.start, independentlyTimed?.end, plan.source_duration_seconds);
        if (text(independentlyTimed?.word) !== text(word.word) || !overlaps(independentlyTimed, source)) throw new Error("Independent clipping proof must identify the retained original word");
        source = independentlyTimed;
      }
      const target = request.edge === "start" ? source.start : source.end;
      const amount = request.edge === "start" ? segment.start - target : target - segment.end;
      if (amount <= EPSILON) throw new Error("Source word does not prove this kept boundary clipped it");
      if (amount > request.seconds + EPSILON || amount > maxExpansion + EPSILON || expanded + amount > totalMaximum + EPSILON) throw new Error("Proven source boundary exceeds repair budget");
      const extension = request.edge === "start" ? { start: target, end: segment.start } : { start: segment.end, end: target };
      checkedRange(extension.start, extension.end, plan.source_duration_seconds);
      if (protectedCuts.some((cut) => overlaps(extension, cut))) throw new Error("Repair would restore rejected filler or take audio");
      if (ranges.some((other, index) => index !== request.segment_index && overlaps(extension, other))) throw new Error("Repair would overlap another kept segment");
      const restoredWord = { start: request.edge === "start" ? target : word.start, end: request.edge === "end" ? target : word.end };
      if (sourceWords.some((other) => other !== word && overlaps(restoredWord, other))) throw new Error("Repair would overlap another retained word");
      segment[request.edge] = target;
      word[request.edge] = target;
      expanded += amount;
      applied.push({ ...request, applied_seconds: amount, source_boundary_seconds: target });
    } catch (error) { rejected.push({ request, reason: error.message }); }
  }
  const surviving = ranges.flatMap((range, index) => {
    const words = sourceWords.filter((word) => word.segment === index);
    if (!words.length) { applied.push({ kind: "drop-wordless-splice", segment_index: index }); return []; }
    return [{ ...range, index, words }];
  });
  if (!surviving.length) throw new Error("Recording repair cannot remove all speech");
  if (options.trimEdges !== false) {
    const first = surviving[0];
    const last = surviving.at(-1);
    if (first.start < first.words[0].start - EPSILON) { applied.push({ kind: "trim-speech-edge", edge: "start", source_boundary_seconds: first.words[0].start }); first.start = first.words[0].start; }
    if (last.end > last.words.at(-1).end + EPSILON) { applied.push({ kind: "trim-speech-edge", edge: "end", source_boundary_seconds: last.words.at(-1).end }); last.end = last.words.at(-1).end; }
  }
  let clock = 0;
  const words = [];
  const kept_segments = surviving.map((range) => {
    const result = { source_start_seconds: range.start, source_end_seconds: range.end, start_seconds: clock, end_seconds: clock + range.end - range.start };
    for (const word of range.words) words.push({ word: word.word, start: word.start - range.start + clock, end: word.end - range.start + clock });
    clock = result.end_seconds;
    return result;
  });
  const removed_segments = complement(kept_segments, plan.source_duration_seconds, plan.removed_segments);
  const repaired = { ...plan, duration_seconds: clock, kept_segments, removed_segments, words, text: words.map((word) => word.word).join(" ") };
  const changed = kept_segments.length !== plan.kept_segments.length || words.length !== plan.words.length
    || kept_segments.some((segment, index) => Object.keys(segment).some((key) => Math.abs(segment[key] - plan.kept_segments[index]?.[key]) > EPSILON))
    || words.some((word, index) => word.word !== (plan.words[index]?.word ?? plan.words[index]?.text) || Math.abs(word.start - plan.words[index]?.start) > EPSILON || Math.abs(word.end - plan.words[index]?.end) > EPSILON);
  return { plan: repaired, applied, rejected, changed };
}

/** Inspect short local PCM windows; impulse candidates are evidence, not permission to cut. */
export async function analyzeRecordingJoins(media, plan, options = {}, adapters = {}) {
  unpackPlan(plan);
  const sampleRate = 48000;
  const halfWindow = 0.04;
  const maximum = options.maxJoins ?? 128;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 256) throw new Error("maxJoins must be between 1 and 256");
  const joins = plan.kept_segments.slice(1).map((segment, index) => ({ at: segment.start_seconds, segment: index + 1 }));
  const offset = options.joinOffset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > joins.length) throw new Error("joinOffset must be an integer within join coverage");
  const stop = Math.min(joins.length, offset + maximum);
  const issues = [];
  const measurements = [];
  const run = adapters.run ?? execute;
  for (const join of joins.slice(offset, stop)) {
    const start = Math.max(0, join.at - halfWindow);
    const end = Math.min(plan.duration_seconds, join.at + halfWindow);
    const output = await run("ffmpeg", ["-hide_banner", "-nostdin", "-ss", String(start), "-i", media, "-t", String(end - start), "-map", "0:a:0", "-vn", "-ar", String(sampleRate), "-ac", "1", "-f", "f32le", "-"], { encoding: null, maxBuffer: 128 * 1024 });
    const buffer = output.stdout;
    if (!Buffer.isBuffer(buffer) || buffer.length < 16 || buffer.length % 4) throw new Error("Join QA requires decoded float PCM evidence");
    const samples = Array.from({ length: buffer.length / 4 }, (_, index) => buffer.readFloatLE(index * 4));
    if (samples.some((sample) => !Number.isFinite(sample))) throw new Error("Invalid join PCM signal");
    const center = Math.round((join.at - start) * sampleRate);
    const radius = Math.round(0.002 * sampleRate);
    const seam = samples.slice(Math.max(0, center - radius), Math.min(samples.length, center + radius));
    const peak = Math.max(...seam.map(Math.abs));
    const outer = [...samples.slice(Math.max(0, center - 0.025 * sampleRate), Math.max(0, center - 0.004 * sampleRate)), ...samples.slice(Math.min(samples.length, center + 0.004 * sampleRate), Math.min(samples.length, center + 0.025 * sampleRate))];
    const rms = outer.length ? Math.sqrt(outer.reduce((sum, sample) => sum + sample * sample, 0) / outer.length) : 1;
    let derivative = 0;
    for (let index = 1; index < seam.length; index++) derivative = Math.max(derivative, Math.abs(seam[index] - seam[index - 1]));
    const candidate = peak >= 0.25 && derivative >= 0.25 && rms <= 0.025 && peak >= Math.max(0.25, rms * 12);
    const record = { segment_index: join.segment, at_seconds: join.at, peak, derivative, surrounding_rms: rms };
    measurements.push(record);
    if (candidate) issues.push({ ...record, kind: "join-click-candidate", edge: "start", proven: false, explanation: "An isolated fast impulse occurs at the join in otherwise quiet audio; inspect source before repairing." });
  }
  return { schema_version: "launchclip.recording-joins.v1", checked: offset === 0 && stop === joins.length, sampled_joins: measurements.length, total_joins: joins.length, join_offset: offset, next_join_offset: stop < joins.length ? stop : null, issues, measurements, unresolved_joins: [...joins.slice(0, offset), ...joins.slice(stop)].map((join) => join.segment) };
}

function unpackPlan(plan) {
  if (!Number.isFinite(plan?.source_duration_seconds) || plan.source_duration_seconds <= 0 || !Number.isFinite(plan.duration_seconds) || plan.duration_seconds <= 0 || !Array.isArray(plan.kept_segments) || !Array.isArray(plan.words) || !plan.words.length || !Array.isArray(plan.removed_segments)) throw new Error("Repair requires a complete timed recording plan");
  let clock = 0;
  let prior = 0;
  const ranges = plan.kept_segments.map((segment) => {
    const range = checkedRange(segment.source_start_seconds, segment.source_end_seconds, plan.source_duration_seconds);
    if (![segment.start_seconds, segment.end_seconds].every(Number.isFinite) || range.start < prior - EPSILON || Math.abs(segment.start_seconds - clock) > EPSILON || Math.abs(segment.end_seconds - (clock + range.end - range.start)) > EPSILON) throw new Error("Invalid recording source/edit mapping");
    clock = segment.end_seconds;
    prior = range.end;
    return range;
  });
  if (Math.abs(clock - plan.duration_seconds) > EPSILON) throw new Error("Recording plan duration differs from keeps");
  const sourceWords = plan.words.map((word) => {
    checkedRange(word.start, word.end, plan.duration_seconds);
    const segment = plan.kept_segments.findIndex((range) => word.start >= range.start_seconds - EPSILON && word.end <= range.end_seconds + EPSILON);
    if (segment < 0 || !String(word.word ?? word.text ?? "").trim()) throw new Error("Accepted recording word crosses a keep boundary");
    const offset = ranges[segment].start - plan.kept_segments[segment].start_seconds;
    return { word: word.word ?? word.text, start: word.start + offset, end: word.end + offset, segment };
  });
  for (let index = 1; index < sourceWords.length; index++) if (sourceWords[index].start < sourceWords[index - 1].end - EPSILON) throw new Error("Accepted recording words must be ordered");
  return { ranges, sourceWords };
}
function checkedRange(start, end, duration) { if (![start, end].every(Number.isFinite) || start < 0 || end <= start || end > duration + EPSILON) throw new Error("Invalid source/word range"); return { start, end }; }
function bound(value, maximum, label) { if (!Number.isFinite(value) || value < 0 || value > maximum) throw new Error(`${label} exceeds the bounded repair policy`); return value; }
function overlaps(left, right) { return left.start < right.end - EPSILON && left.end > right.start + EPSILON; }
function text(value) { return String(value).toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""); }
function complement(keeps, duration, priorCuts) {
  const removed = [];
  let cursor = 0;
  for (const keep of [...keeps, { source_start_seconds: duration, source_end_seconds: duration }]) {
    if (keep.source_start_seconds > cursor + EPSILON) {
      const protectedReason = priorCuts.find((cut) => PROTECTED_REASONS.has(cut.reason) && overlaps({ start: cursor, end: keep.source_start_seconds }, { start: cut.source_start_seconds, end: cut.source_end_seconds }))?.reason;
      removed.push({ source_start_seconds: cursor, source_end_seconds: keep.source_start_seconds, reason: protectedReason ?? priorCuts.find((cut) => overlaps({ start: cursor, end: keep.source_start_seconds }, { start: cut.source_start_seconds, end: cut.source_end_seconds }))?.reason ?? "qa-speech-edge" });
    }
    cursor = keep.source_end_seconds;
  }
  return removed;
}

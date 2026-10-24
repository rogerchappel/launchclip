// launchclip subject setup | probe <media> | matte <media> --range <in>-<out>

import path from "node:path";
import { DEFAULT_PROBE_MODEL, DEFAULT_SUBJECT_MODEL, ensurePipeline, subjectModel, subjectPipeline } from "./models.js";
import { fileProjectMatte } from "./project.js";
import { parseRange, runSubjectMatte, runSubjectProbe } from "./stage.js";

export const SUBJECT_ACTIONS = Object.freeze(["setup", "probe", "matte"]);

export function parseSubjectInvocation(action, rest) {
  if (!action) throw new Error(`Missing subject action; use ${SUBJECT_ACTIONS.join(", ")}`);
  if (!SUBJECT_ACTIONS.includes(action)) throw new Error(`Unknown subject action: ${action}`);
  if (action === "setup") return { action, media: null, flagArgs: rest };
  const media = rest[0] && !rest[0].startsWith("--") ? rest[0] : null;
  if (!media) throw new Error(`subject ${action} needs a video, e.g. launchclip subject ${action} assets/recording.mp4${action === "matte" ? " --range 4-10" : ""}`);
  return { action, media, flagArgs: rest.slice(1) };
}

/** → a JSON-ready report; `log` gets progress lines (stderr). */
export async function runSubjectCommand(action, media, flags = {}, { log = () => {}, fetchImpl } = {}) {
  const model = String(flags.model ?? (action === "probe" ? DEFAULT_PROBE_MODEL : DEFAULT_SUBJECT_MODEL));
  const pipeline = subjectPipeline(model);
  const common = {
    model,
    // With --project, the cache lives in the project (its .launchclip/subject).
    cacheDir: flags.cache ? path.resolve(String(flags.cache)) : flags.project ? path.resolve(String(flags.project), ".launchclip", "subject") : undefined,
    force: Boolean(flags.force),
    download: !flags["no-download"],
    smooth: flags.smooth === undefined ? 0 : boundedNumber(flags.smooth, 0, 0.9, "--smooth"),
    log,
    ...(fetchImpl ? { fetchImpl } : {})
  };
  if (action === "setup") {
    // The default pipeline covers the probe model too.
    const files = await ensurePipeline(model, common);
    return { stage: "subject", action, model, models: pipeline.models.map((id) => ({ id, path: files[id], licence: subjectModel(id).licence })), installed: true };
  }
  const src = path.resolve(media);
  if (action === "probe") {
    const { probe, path: file, cached } = await runSubjectProbe(src, common);
    const { samples, ...summary } = probe;
    return { stage: "subject", action, media: src, path: file, cached, samples: samples.length, ...summary };
  }
  const range = parseRange(flags.range);
  let last = 0;
  const { info, dir, matte, plate, subject, cached, seconds } = await runSubjectMatte(src, range, {
    ...common,
    onFrame: (count) => {
      if (count - last >= 30) {
        last = count;
        log(`matted ${count} frames`);
      }
    }
  });
  const filed = flags.project ? await fileProjectMatte(String(flags.project), src, { info, matte, plate }) : null;
  const { frames, ...summary } = info;
  return { stage: "subject", action, media: src, dir, matte, subject, cached, seconds, frames: frames.length, ...(filed ? { filed } : {}), ...summary };
}

export function formatSubjectReport(report) {
  if (report.action === "setup") return `${report.model} is installed:\n${report.models.map((model) => `  ${model.id} (${model.licence}) ${model.path}`).join("\n")}\n`;
  const lines = [];
  const where = report.action === "probe" ? report.path : report.subject;
  lines.push(`${report.action === "probe" ? "Probe" : "Matte"} ${report.cached ? "(cached) " : ""}for ${report.media}`);
  lines.push(`  people: ${report.people}   framing: ${report.framing ?? "—"}   coverage: ${pct(report.coverage)}   stability: ${report.stability}`);
  if (report.head) lines.push(`  head: x ${report.head.x}, y ${report.head.y}, ${report.head.w}×${report.head.h}   headroom: ${pct(report.headroom)}`);
  lines.push(report.usable ? "  usable: yes" : `  usable: no — ${report.reasons.join("; ")}`);
  if (report.action === "matte") lines.push(`  ${report.frames} frames${report.cached ? "" : ` in ${report.seconds} s`} → ${report.matte}`);
  if (report.filed) lines.push(`  filed for ${report.filed.base} as ${report.filed.src} (base.subject "auto" picks it up)`);
  lines.push(`  ${where}`);
  return `${lines.join("\n")}\n`;
}

function boundedNumber(value, min, max, name) {
  const number = Number(value);
  if (!(number >= min && number <= max)) throw new Error(`${name} must be between ${min} and ${max}`);
  return number;
}

const pct = (value) => (value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`);

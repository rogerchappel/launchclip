// `launchclip evidence capture <request.json>` (clip, poster, sidecar; --still
// for one hi-res crop), `launchclip evidence check <request.json>` (validate
// only) and `launchclip evidence scene <id>.evidence.json` (evidence-clip
// params for a storyboard scene). Contract: docs/EVIDENCE_CAPTURE.md.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { evidenceClipParams } from "@launchclip/core/catalog-d.mjs";
import { normalizeTarget, validateCaptureRequest } from "./request.js";

async function readJson(file, what) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch (error) { throw new Error(`${what} ${file} is not readable JSON: ${error.message}`); }
}

// --target ".css" or --target "text:gpt-6.1-terra".
const targetFlag = (value) => (typeof value !== "string" ? null : value.startsWith("text:") ? { text: value.slice(5) } : normalizeTarget(value));

export async function runEvidenceCommand(action, target, flags = {}, { log = () => {}, capture } = {}) {
  if (!target) throw new Error(`launchclip evidence ${action ?? "capture"} needs a file (${action === "scene" ? "<id>.evidence.json" : "a launchclip.capture.v1 request"})`);
  if (action === "scene") {
    const record = await readJson(target, "sidecar");
    if (record.schema !== "launchclip.evidence.v1" || !record.video) throw new Error(`${target} is not a launchclip.evidence.v1 clip sidecar`);
    const src = flags.src ?? `assets/evidence/${path.basename(record.video)}`;
    return { stage: "evidence-scene", id: record.id, duration: record.duration, module: "evidence-clip", params: evidenceClipParams(record, { src, frame: flags.frame }) };
  }
  const input = await readJson(target, "capture request");
  const { errors, warnings, request } = validateCaptureRequest(input);
  if (action === "check") return { stage: "evidence-check", ok: errors.length === 0, errors, warnings, ...(errors.length ? {} : { request }) };
  if (action !== "capture") throw new Error(`unknown evidence action "${action}" (capture, check or scene)`);
  if (errors.length) throw new Error(`capture request ${target} has errors:\n- ${errors.join("\n- ")}`);
  const { captureEvidence, captureStill } = capture ?? await import("./capture.js");
  // Relative outputs land under --root (default: the current story project).
  const root = path.resolve(flags.root ?? ".");
  if (flags.still) {
    const scale = flags.scale === undefined ? undefined : Number(flags.scale), pad = flags.pad === undefined ? undefined : Number(flags.pad);
    const result = await captureStill(input, { root, target: targetFlag(flags.target), scale, pad, log });
    return { stage: "evidence-still", id: request.id, still: result.still, sidecar: result.sidecar, final_url: result.record.final_url, consent: result.record.consent };
  }
  const result = await captureEvidence(input, { root, log });
  return {
    stage: "evidence-capture", id: request.id, video: result.video, poster: result.poster, sidecar: result.sidecar, fullpage: result.fullpage,
    duration: result.record.duration, final_url: result.record.final_url, consent: result.record.consent, spans: result.record.spans.map((span) => span.text),
    next: `launchclip evidence scene ${path.relative(process.cwd(), result.sidecar)} prints the evidence-clip scene params`
  };
}
